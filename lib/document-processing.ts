import { createHash } from "node:crypto";
import { DOCUMENT_PARSER_VERSION, parseOperationalDocumentText } from "@/lib/document-parser";
import { getIngestionEnv } from "@/lib/env";
import { extractPdfText } from "@/lib/pdf-extract";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

type ProcessResult = {
  draftId: string;
  status: string;
  itemCount: number;
  skippedApproved: boolean;
};

function errorText(error: unknown): string {
  return error instanceof Error
    ? error.message.slice(0, 1000)
    : "Unknown document parsing error";
}

function draftRow(
  messageId: string,
  extractedText: string,
  pageCount: number,
) {
  const parsed = parseOperationalDocumentText(extractedText);

  return {
    message_id: messageId,
    parser_version: parsed.parserVersion,
    parse_status: parsed.parseStatus,
    document_type: parsed.documentType,
    supplier_name: parsed.supplierName,
    supplier_gstin: parsed.supplierGstin,
    supplier_address: parsed.supplierAddress,
    document_number: parsed.documentNumber,
    document_date: parsed.documentDate,
    eway_bill_number: parsed.ewayBillNumber,
    consignee_name: parsed.consigneeName,
    consignee_address: parsed.consigneeAddress,
    consignee_gstin: parsed.consigneeGstin,
    consignee_pincode: parsed.consigneePincode,
    consignee_phone: parsed.consigneePhone,
    buyer_name: parsed.buyerName,
    buyer_address: parsed.buyerAddress,
    buyer_gstin: parsed.buyerGstin,
    buyer_pincode: parsed.buyerPincode,
    buyer_phone: parsed.buyerPhone,
    destination: parsed.destination,
    dispatch_from_address: parsed.dispatchFromAddress,
    vehicle_number: parsed.vehicleNumber,
    approximate_distance_km: parsed.approximateDistanceKm,
    eway_generated_at_text: parsed.ewayGeneratedAtText,
    eway_valid_until_text: parsed.ewayValidUntilText,
    supply_type: parsed.supplyType,
    transaction_type: parsed.transactionType,
    taxable_amount: parsed.taxableAmount,
    cgst_amount: parsed.cgstAmount,
    sgst_amount: parsed.sgstAmount,
    total_amount: parsed.totalAmount,
    page_count: pageCount,
    extracted_text: extractedText,
    text_sha256: createHash("sha256").update(extractedText, "utf8").digest("hex"),
    text_length: extractedText.length,
    missing_fields: parsed.missingFields,
    extra_fields: {},
    parse_error: null,
    extracted_at: new Date().toISOString(),
    approved_at: null,
    items: parsed.items,
  };
}

async function existingDraft(messageId: string) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("document_drafts")
    .select("id, parse_status, workflow_status")
    .eq("message_id", messageId)
    .maybeSingle();

  if (error) {
    throw new Error("Failed to inspect document draft: " + error.message);
  }

  return data as {
    id: string;
    parse_status: string;
    workflow_status: string;
  } | null;
}

export async function processPdfBytesForMessage(
  messageId: string,
  bytes: Buffer,
): Promise<ProcessResult> {
  const supabase = getSupabaseAdmin();
  const existing = await existingDraft(messageId);

  if (
    existing?.parse_status === "approved" ||
    existing?.workflow_status === "cancelled"
  ) {
    return {
      draftId: existing.id,
      status:
        existing.workflow_status === "cancelled" ? "cancelled" : "approved",
      itemCount: 0,
      skippedApproved: true,
    };
  }

  try {
    const extracted = await extractPdfText(bytes);
    const row = draftRow(messageId, extracted.text, extracted.pageCount);
    const items = row.items;
    const persistedRow = { ...row };
    delete (persistedRow as Partial<typeof row>).items;

    const { data: savedDraft, error: draftError } = await supabase
      .from("document_drafts")
      .upsert(persistedRow, { onConflict: "message_id" })
      .select("id, parse_status")
      .single();

    if (draftError || !savedDraft) {
      throw new Error(
        "Failed to persist document draft: " +
          (draftError?.message ?? "missing draft result"),
      );
    }

    const { error: deleteError } = await supabase
      .from("document_items")
      .delete()
      .eq("draft_id", savedDraft.id);

    if (deleteError) {
      throw new Error("Failed to replace document items: " + deleteError.message);
    }

    if (items.length > 0) {
      const { error: itemError } = await supabase
        .from("document_items")
        .insert(
          items.map((item, index) => ({
            draft_id: savedDraft.id,
            line_index: index,
            source_line_number: item.sourceLineNumber,
            description: item.description,
            normalized_description: item.normalizedDescription,
            hsn_sac: item.hsnSac,
            quantity: item.quantity,
            unit: item.unit,
            rate: item.rate,
            amount: item.amount,
          })),
        );

      if (itemError) {
        await supabase
          .from("document_drafts")
          .update({
            parse_status: "failed",
            parse_error: ("Item persistence failed: " + itemError.message).slice(0, 1000),
          })
          .eq("id", savedDraft.id);
        throw new Error("Failed to persist document items: " + itemError.message);
      }
    }

    return {
      draftId: savedDraft.id,
      status: savedDraft.parse_status,
      itemCount: items.length,
      skippedApproved: false,
    };
  } catch (error) {
    const message = errorText(error);

    if (existing) {
      await supabase
        .from("document_drafts")
        .update({
          parse_status: "failed",
          parse_error: message,
          extracted_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
    } else {
      await supabase.from("document_drafts").insert({
        message_id: messageId,
        parser_version: DOCUMENT_PARSER_VERSION,
        parse_status: "failed",
        missing_fields: [],
        extra_fields: {},
        parse_error: message,
        extracted_at: new Date().toISOString(),
      });
    }

    throw error;
  }
}

export async function processStoredPdfMessage(
  messageId: string,
): Promise<ProcessResult> {
  const supabase = getSupabaseAdmin();
  const { data: message, error: messageError } = await supabase
    .from("whatsapp_messages")
    .select("id, storage_path, mime_type, original_filename")
    .eq("id", messageId)
    .maybeSingle();

  if (messageError) {
    throw new Error("Failed to load stored document: " + messageError.message);
  }
  if (!message) {
    throw new Error("Stored document was not found");
  }
  if (!message.storage_path) {
    throw new Error("Raw document is no longer available");
  }

  const isPdf =
    message.mime_type?.toLowerCase() === "application/pdf" ||
    message.original_filename?.toLowerCase().endsWith(".pdf");
  if (!isPdf) {
    throw new Error("Only PDF document parsing is enabled in this phase");
  }

  const env = getIngestionEnv();
  const { data, error: downloadError } = await supabase.storage
    .from(env.SUPABASE_STORAGE_BUCKET)
    .download(message.storage_path);

  if (downloadError || !data) {
    throw new Error(
      "Failed to load private PDF: " +
        (downloadError?.message ?? "missing file"),
    );
  }

  return processPdfBytesForMessage(
    message.id,
    Buffer.from(await data.arrayBuffer()),
  );
}

export async function approveDocumentDraft(
  messageId: string,
): Promise<void> {
  const supabase = getSupabaseAdmin();

  const { data: draft, error: readError } = await supabase
    .from("document_drafts")
    .select("id, parse_status, workflow_status")
    .eq("message_id", messageId)
    .maybeSingle();

  if (readError) {
    throw new Error("Failed to load document draft: " + readError.message);
  }
  if (!draft) {
    throw new Error("Document draft was not found");
  }
  if (draft.workflow_status === "cancelled") {
    throw new Error("Cancelled document drafts cannot be approved");
  }
  if (draft.parse_status !== "ready_for_review") {
    throw new Error("Only complete parser drafts can be approved");
  }

  const { error } = await supabase
    .from("document_drafts")
    .update({
      parse_status: "approved",
      approved_at: new Date().toISOString(),
      workflow_status: "recorded",
      verification_status: "manual_override",
      parse_error: null,
    })
    .eq("id", draft.id)
    .eq("parse_status", "ready_for_review");

  if (error) {
    throw new Error("Failed to approve document draft: " + error.message);
  }
}
