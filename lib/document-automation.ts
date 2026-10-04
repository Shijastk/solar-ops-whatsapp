import { getDocumentAutomationEnv } from "@/lib/env";
import {
  compareDocumentVerification,
  extractDocumentWithGroq,
  verifyDocumentDeterministically,
  type VerificationCandidate,
} from "@/lib/document-verifier";
import { deterministicUuid } from "@/lib/idempotency";
import { sendOpsList, sendOpsReply, sendOpsReplyButtons } from "@/lib/replies";
import {
  applyStockQuantityCorrection,
  reverseStockForDraft,
} from "@/lib/stock";
import {
  handleStockWorkflowInbound,
  processStockForDraft,
} from "@/lib/stock-workflow";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type { NormalizedWhatsAppMessage } from "@/lib/whatsapp";
import { handleFastWhatsAppQuery } from "@/lib/whatsapp-queries";
import { handleTripWorkflowInbound } from "@/lib/trips";

const EDIT_SESSION_MINUTES = 15;
const SUMMARY_ITEM_LIMIT = 6;
const EDIT_ITEM_LIMIT = 8;

type DraftItem = {
  id: string;
  description: string;
  hsnSac: string | null;
  quantity: number | null;
  unit: string | null;
  rate: number | null;
  amount: number | null;
};

type DraftContext = {
  id: string;
  messageId: string;
  senderPhone: string;
  parseStatus: string;
  workflowStatus: string;
  verificationStatus: string;
  verificationProvider: string | null;
  verificationModel: string | null;
  stockStatus: string;
  summarySentAt: string | null;
  extractedText: string | null;
  documentType: string | null;
  supplierName: string | null;
  supplierGstin: string | null;
  supplierAddress: string | null;
  documentNumber: string | null;
  documentDate: string | null;
  ewayBillNumber: string | null;
  consigneeName: string | null;
  consigneeAddress: string | null;
  consigneeGstin: string | null;
  consigneePincode: string | null;
  consigneePhone: string | null;
  buyerName: string | null;
  buyerAddress: string | null;
  buyerGstin: string | null;
  buyerPincode: string | null;
  buyerPhone: string | null;
  destination: string | null;
  dispatchFromAddress: string | null;
  vehicleNumber: string | null;
  approximateDistanceKm: number | null;
  ewayGeneratedAtText: string | null;
  ewayValidUntilText: string | null;
  supplyType: string | null;
  transactionType: string | null;
  taxableAmount: number | null;
  cgstAmount: number | null;
  sgstAmount: number | null;
  totalAmount: number | null;
  items: DraftItem[];
};

export type DocumentWorkflowAction =
  | { type: "edit"; draftId: string }
  | { type: "delete"; draftId: string }
  | { type: "delete_confirm"; draftId: string }
  | { type: "delete_keep"; draftId: string }
  | { type: "edit_cancel"; draftId: string }
  | {
      type: "edit_field";
      draftId: string;
      field: "document_number" | "vehicle_number";
    }
  | { type: "edit_item_quantity"; draftId: string; itemId: string };

function trimForWhatsApp(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, Math.max(1, max - 1)).trimEnd() + "…";
}

function formatQuantity(value: number | null): string {
  if (value === null) return "—";
  return Number.isInteger(value)
    ? String(value)
    : String(value).replace(/0+$/, "").replace(/\.$/, "");
}

function formatMoney(value: number | null): string | null {
  if (value === null) return null;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(value);
}

export function buildDocumentSummary(
  input: Pick<
    DraftContext,
    | "supplierName"
    | "documentNumber"
    | "vehicleNumber"
    | "totalAmount"
    | "items"
  > & { stockStatus?: string },
  heading = "✅ ബിൽ പരിശോധിച്ച് സ്ഥിരീകരിച്ചു",
): string {
  const lines = [heading];

  if (input.supplierName) {
    lines.push("കമ്പനി: " + trimForWhatsApp(input.supplierName, 70));
  }
  if (input.documentNumber) {
    lines.push("ബിൽ നമ്പർ: " + trimForWhatsApp(input.documentNumber, 60));
  }
  if (input.vehicleNumber) {
    lines.push("വാഹനം: " + trimForWhatsApp(input.vehicleNumber, 32));
  }

  if (input.items.length > 0) {
    lines.push("", "സാധനങ്ങൾ:");
    for (const [index, item] of input.items
      .slice(0, SUMMARY_ITEM_LIMIT)
      .entries()) {
      lines.push(
        String(index + 1) +
          ". " +
          trimForWhatsApp(item.description, 72) +
          " — " +
          formatQuantity(item.quantity) +
          (item.unit ? " " + item.unit : ""),
      );
    }

    if (input.items.length > SUMMARY_ITEM_LIMIT) {
      lines.push(
        "+ " + String(input.items.length - SUMMARY_ITEM_LIMIT) + " സാധനം കൂടി",
      );
    }
  }

  const total = formatMoney(input.totalAmount);
  if (total) lines.push("", "ആകെ: " + total);

  const stockStatus = input.stockStatus ?? "not_ready";
  if (stockStatus === "applied") {
    lines.push("", "✅ Outgoing stock history-ൽ രേഖപ്പെടുത്തി.");
  } else if (stockStatus === "duplicate_document") {
    lines.push(
      "",
      "ℹ️ ഈ ബിൽ നേരത്തെ സ്റ്റോക്കിൽ രേഖപ്പെടുത്തിയതാണ്. അതിനാൽ സ്റ്റോക്ക് വീണ്ടും കുറച്ചിട്ടില്ല.",
    );
  } else if (stockStatus === "reversed") {
    lines.push("", "↩️ സ്റ്റോക്കിൽ നിന്ന് കുറച്ചത് തിരികെ ചേർത്തു.");
  } else {
    lines.push("", "⏳ സ്റ്റോക്ക് അപ്ഡേറ്റ് പൂർത്തിയായിട്ടില്ല.");
  }
  return trimForWhatsApp(lines.join("\n"), 950);
}

export function parseDocumentWorkflowAction(
  value: string,
): DocumentWorkflowAction | null {
  const parts = value.split(":");

  if (parts[0] !== "so" || parts[1] !== "doc") return null;

  if (parts[2] === "edit" && parts.length === 4) {
    return { type: "edit", draftId: parts[3] };
  }
  if (parts[2] === "delete" && parts.length === 4) {
    return { type: "delete", draftId: parts[3] };
  }
  if (parts[2] === "delete_confirm" && parts.length === 4) {
    return { type: "delete_confirm", draftId: parts[3] };
  }
  if (parts[2] === "delete_keep" && parts.length === 4) {
    return { type: "delete_keep", draftId: parts[3] };
  }
  if (parts[2] === "edit_cancel" && parts.length === 4) {
    return { type: "edit_cancel", draftId: parts[3] };
  }
  if (
    parts[2] === "field" &&
    parts.length === 5 &&
    (parts[3] === "document_number" || parts[3] === "vehicle_number")
  ) {
    return {
      type: "edit_field",
      draftId: parts[4],
      field: parts[3],
    };
  }
  if (parts[2] === "qty" && parts.length === 5) {
    return {
      type: "edit_item_quantity",
      draftId: parts[3],
      itemId: parts[4],
    };
  }

  return null;
}

export function normalizeCorrectionValue(
  target: "document_number" | "vehicle_number" | "item_quantity",
  value: string,
): string | number | null {
  const trimmed = value.trim();

  if (target === "document_number") {
    if (!trimmed || trimmed.length > 120) return null;
    return trimmed;
  }

  if (target === "vehicle_number") {
    const normalized = trimmed.toUpperCase().replace(/\s+/g, " ");
    if (
      !normalized ||
      normalized.length > 32 ||
      !/^[A-Z0-9 /-]+$/.test(normalized)
    ) {
      return null;
    }
    return normalized;
  }

  if (!/^\d{1,12}(?:\.\d{1,3})?$/.test(trimmed)) return null;
  const quantity = Number(trimmed);
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  return quantity;
}

async function loadDraftContext(draftId: string): Promise<DraftContext | null> {
  const supabase = getSupabaseAdmin();

  const { data: draft, error: draftError } = await supabase
    .from("document_drafts")
    .select(
      "id, message_id, parse_status, workflow_status, verification_status, verification_provider, verification_model, stock_status, summary_sent_at, extracted_text, document_type, supplier_name, supplier_gstin, supplier_address, document_number, document_date, eway_bill_number, consignee_name, consignee_address, consignee_gstin, consignee_pincode, consignee_phone, buyer_name, buyer_address, buyer_gstin, buyer_pincode, buyer_phone, destination, dispatch_from_address, vehicle_number, approximate_distance_km, eway_generated_at_text, eway_valid_until_text, supply_type, transaction_type, taxable_amount, cgst_amount, sgst_amount, total_amount",
    )
    .eq("id", draftId)
    .maybeSingle();

  if (draftError) {
    throw new Error(
      "Failed to load document automation draft: " + draftError.message,
    );
  }
  if (!draft) return null;

  const [
    { data: message, error: messageError },
    { data: items, error: itemError },
  ] = await Promise.all([
    supabase
      .from("whatsapp_messages")
      .select("sender_phone")
      .eq("id", draft.message_id)
      .maybeSingle(),
    supabase
      .from("document_items")
      .select("id, description, hsn_sac, quantity, unit, rate, amount")
      .eq("draft_id", draft.id)
      .order("line_index", { ascending: true }),
  ]);

  if (messageError) {
    throw new Error("Failed to load document sender: " + messageError.message);
  }
  if (!message) {
    throw new Error("Document sender was not found");
  }
  if (itemError) {
    throw new Error("Failed to load document items: " + itemError.message);
  }

  return {
    id: draft.id,
    messageId: draft.message_id,
    senderPhone: message.sender_phone,
    parseStatus: draft.parse_status,
    workflowStatus: draft.workflow_status,
    verificationStatus: draft.verification_status,
    verificationProvider: draft.verification_provider,
    verificationModel: draft.verification_model,
    stockStatus: draft.stock_status,
    summarySentAt: draft.summary_sent_at,
    extractedText: draft.extracted_text,
    documentType: draft.document_type,
    supplierName: draft.supplier_name,
    supplierGstin: draft.supplier_gstin,
    supplierAddress: draft.supplier_address,
    documentNumber: draft.document_number,
    documentDate: draft.document_date,
    ewayBillNumber: draft.eway_bill_number,
    consigneeName: draft.consignee_name,
    consigneeAddress: draft.consignee_address,
    consigneeGstin: draft.consignee_gstin,
    consigneePincode: draft.consignee_pincode,
    consigneePhone: draft.consignee_phone,
    buyerName: draft.buyer_name,
    buyerAddress: draft.buyer_address,
    buyerGstin: draft.buyer_gstin,
    buyerPincode: draft.buyer_pincode,
    buyerPhone: draft.buyer_phone,
    destination: draft.destination,
    dispatchFromAddress: draft.dispatch_from_address,
    vehicleNumber: draft.vehicle_number,
    approximateDistanceKm:
      draft.approximate_distance_km === null
        ? null
        : Number(draft.approximate_distance_km),
    ewayGeneratedAtText: draft.eway_generated_at_text,
    ewayValidUntilText: draft.eway_valid_until_text,
    supplyType: draft.supply_type,
    transactionType: draft.transaction_type,
    taxableAmount:
      draft.taxable_amount === null ? null : Number(draft.taxable_amount),
    cgstAmount: draft.cgst_amount === null ? null : Number(draft.cgst_amount),
    sgstAmount: draft.sgst_amount === null ? null : Number(draft.sgst_amount),
    totalAmount:
      draft.total_amount === null ? null : Number(draft.total_amount),
    items: (items ?? []).map((item) => ({
      id: item.id,
      description: item.description,
      hsnSac: item.hsn_sac,
      quantity: item.quantity === null ? null : Number(item.quantity),
      unit: item.unit,
      rate: item.rate === null ? null : Number(item.rate),
      amount: item.amount === null ? null : Number(item.amount),
    })),
  };
}

async function assertDraftSender(
  draftId: string,
  senderPhone: string,
): Promise<DraftContext> {
  const draft = await loadDraftContext(draftId);
  if (!draft || draft.senderPhone !== senderPhone) {
    throw new Error("Document action does not match the sender");
  }
  return draft;
}

async function recordAction(input: {
  draftId: string;
  sourceMessageId?: string | null;
  action: string;
  fieldKey?: string | null;
  previousValue?: unknown;
  newValue?: unknown;
}) {
  const supabase = getSupabaseAdmin();
  const actionKey = deterministicUuid(
    [
      "document-action",
      input.draftId,
      input.sourceMessageId ?? "",
      input.action,
      input.fieldKey ?? "",
    ].join(":"),
  );

  const { error } = await supabase.from("document_actions").insert({
    action_key: actionKey,
    draft_id: input.draftId,
    source_message_id: input.sourceMessageId ?? null,
    action: input.action,
    field_key: input.fieldKey ?? null,
    previous_value:
      input.previousValue === undefined ? null : input.previousValue,
    new_value: input.newValue === undefined ? null : input.newValue,
  });

  if (error?.code === "23505") return;

  if (error) {
    throw new Error("Failed to write document audit action: " + error.message);
  }
}

async function updateAutomationState(
  draftId: string,
  values: Record<string, unknown>,
) {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("document_drafts")
    .update(values)
    .eq("id", draftId);

  if (error) {
    throw new Error(
      "Failed to update document automation state: " + error.message,
    );
  }
}

async function canonicalSupplierName(
  gstin: string | null,
): Promise<string | null> {
  if (!gstin) return null;
  const normalized = gstin.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("stock_companies")
    .select("canonical_name")
    .eq("gstin", normalized)
    .eq("active", true)
    .maybeSingle();

  if (error) {
    console.warn("Canonical company name lookup failed", {
      reason: error.message.slice(0, 180),
    });
    return null;
  }
  return data?.canonical_name ?? null;
}

async function sendSummary(
  draft: DraftContext,
  replyToMessageId: string,
  requestSeed: string,
  heading?: string,
) {
  if (draft.stockStatus === "duplicate_document") {
    return sendOpsReply({
      requestId: deterministicUuid(requestSeed),
      replyToMessageId,
      body:
        "ℹ️ ബിൽ " +
        (draft.documentNumber ?? "") +
        " നേരത്തെ upload ചെയ്തിട്ടുണ്ട്. Already uploaded.",
    });
  }
  const companyName = await canonicalSupplierName(draft.supplierGstin);
  const body = buildDocumentSummary(
    { ...draft, supplierName: companyName ?? draft.supplierName },
    heading,
  );
  const result = await sendOpsReplyButtons({
    requestId: deterministicUuid(requestSeed),
    replyToMessageId,
    body,
    buttons: [
      { id: "so:doc:edit:" + draft.id, title: "തിരുത്തുക" },
      { id: "so:doc:delete:" + draft.id, title: "ഒഴിവാക്കുക" },
    ],
  });

  if (result.status === "sent" && result.metaMessageId) {
    await updateAutomationState(draft.id, {
      summary_sent_at: new Date().toISOString(),
      summary_meta_message_id: result.metaMessageId,
    });
    await recordAction({
      draftId: draft.id,
      action: "summary_sent",
      newValue: { message_kind: "interactive" },
    });
  }

  return result;
}

async function recordVerifiedDraft(
  draft: DraftContext,
  verification: {
    provider: string;
    model: string | null;
    details: Record<string, unknown>;
  },
  suppressReply = false,
): Promise<"recorded"> {
  const now = new Date().toISOString();
  await updateAutomationState(draft.id, {
    parse_status: "approved",
    approved_at: now,
    workflow_status: "recorded",
    verification_status: "verified",
    verification_provider: verification.provider,
    verification_model: verification.model,
    verification_details: verification.details,
    parse_error: null,
  });
  await recordAction({
    draftId: draft.id,
    sourceMessageId: draft.messageId,
    action: "auto_recorded",
    newValue: {
      verifier: verification.details.verifier ?? verification.provider,
      model: verification.model,
      item_count: draft.items.length,
    },
  });

  let stockStatus = "pending";
  try {
    const stockResult = await processStockForDraft({
      draftId: draft.id,
      replyToMessageId: draft.messageId,
      notifySuccess: false,
      suppressNotifications: suppressReply,
    });
    if (
      stockResult.status === "applied" ||
      stockResult.status === "already_applied"
    ) {
      stockStatus = "applied";
    } else if (stockResult.status === "duplicate_document") {
      stockStatus = "duplicate_document";
    }
  } catch (error) {
    console.warn("Verified document stock update did not complete", {
      reason:
        error instanceof Error
          ? error.message.slice(0, 180)
          : "Unknown stock error",
    });
  }

  const recorded = {
    ...draft,
    parseStatus: "approved",
    workflowStatus: "recorded",
    verificationStatus: "verified",
    verificationProvider: verification.provider,
    verificationModel: verification.model,
    stockStatus,
  };
  try {
    if (!suppressReply) {
      await sendSummary(
        recorded,
        draft.messageId,
        "document-summary:" + draft.id,
      );
    }
  } catch (error) {
    console.warn("Verified document summary was not sent", {
      reason:
        error instanceof Error
          ? error.message.slice(0, 180)
          : "Unknown outbound error",
    });
  }

  return "recorded";
}

async function sendReviewNotice(
  draft: DraftContext,
  reason: "needs_review" | "verification_failed",
) {
  const body =
    reason === "needs_review"
      ? "⚠️ ബിൽ ലഭിച്ചു. പക്ഷേ വിവരങ്ങൾ സുരക്ഷിതമായി സ്ഥിരീകരിക്കാൻ കഴിഞ്ഞില്ല. ഒന്നും സ്വയമേവ രേഖപ്പെടുത്തിയിട്ടില്ല. Solar Ops-ൽ പരിശോധിക്കുക."
      : "⚠️ ബിൽ ലഭിച്ചു. ഇപ്പോൾ സ്വയമേവ പരിശോധിക്കാൻ കഴിഞ്ഞില്ല. ഒന്നും സ്വയമേവ രേഖപ്പെടുത്തിയിട്ടില്ല. Solar Ops-ൽ പരിശോധിക്കുക.";

  await sendOpsReply({
    requestId: deterministicUuid("document-review:" + draft.id + ":" + reason),
    replyToMessageId: draft.messageId,
    body,
  });
}

async function trySendReviewNotice(
  draft: DraftContext,
  reason: "needs_review" | "verification_failed",
) {
  try {
    await sendReviewNotice(draft, reason);
  } catch (error) {
    console.warn("Document review notice was not sent", {
      reason:
        error instanceof Error
          ? error.message.slice(0, 180)
          : "Unknown outbound error",
    });
  }
}

function verificationCandidate(draft: DraftContext): VerificationCandidate {
  return {
    documentType: draft.documentType,
    supplierName: draft.supplierName,
    supplierGstin: draft.supplierGstin,
    supplierAddress: draft.supplierAddress,
    documentNumber: draft.documentNumber,
    documentDate: draft.documentDate,
    ewayBillNumber: draft.ewayBillNumber,
    consigneeName: draft.consigneeName,
    consigneeAddress: draft.consigneeAddress,
    consigneeGstin: draft.consigneeGstin,
    consigneePincode: draft.consigneePincode,
    consigneePhone: draft.consigneePhone,
    buyerName: draft.buyerName,
    buyerAddress: draft.buyerAddress,
    buyerGstin: draft.buyerGstin,
    buyerPincode: draft.buyerPincode,
    buyerPhone: draft.buyerPhone,
    destination: draft.destination,
    dispatchFromAddress: draft.dispatchFromAddress,
    vehicleNumber: draft.vehicleNumber,
    approximateDistanceKm: draft.approximateDistanceKm,
    ewayGeneratedAtText: draft.ewayGeneratedAtText,
    ewayValidUntilText: draft.ewayValidUntilText,
    supplyType: draft.supplyType,
    transactionType: draft.transactionType,
    taxableAmount: draft.taxableAmount,
    cgstAmount: draft.cgstAmount,
    sgstAmount: draft.sgstAmount,
    totalAmount: draft.totalAmount,
    items: draft.items.map((item) => ({
      description: item.description,
      hsnSac: item.hsnSac,
      quantity: item.quantity,
      unit: item.unit,
      rate: item.rate,
      amount: item.amount,
    })),
  };
}

export async function runDocumentAutomationForDraft(
  draftId: string,
  options: { suppressReply?: boolean } = {},
): Promise<
  "disabled" | "recorded" | "review_required" | "cancelled" | "already_recorded"
> {
  const env = getDocumentAutomationEnv();
  if (!env.enabled) return "disabled";
  const suppressReply = Boolean(options.suppressReply);

  const draft = await loadDraftContext(draftId);
  if (!draft) {
    throw new Error("Document draft was not found");
  }

  if (draft.workflowStatus === "cancelled") return "cancelled";

  if (
    draft.workflowStatus === "recorded" &&
    draft.verificationStatus === "verified"
  ) {
    let stockStatus = draft.stockStatus;
    try {
      const stockResult = await processStockForDraft({
        draftId: draft.id,
        replyToMessageId: draft.messageId,
        notifySuccess: false,
        suppressNotifications: suppressReply,
      });
      if (
        stockResult.status === "applied" ||
        stockResult.status === "already_applied"
      ) {
        stockStatus = "applied";
      } else if (stockResult.status === "duplicate_document") {
        stockStatus = "duplicate_document";
      }
    } catch (error) {
      console.warn("Recorded document stock update did not complete", {
        reason:
          error instanceof Error
            ? error.message.slice(0, 180)
            : "Unknown stock error",
      });
    }

    if (!suppressReply && !draft.summarySentAt) {
      await sendSummary(
        { ...draft, stockStatus },
        draft.messageId,
        "document-summary:" + draft.id,
      );
    }
    return "already_recorded";
  }

  if (
    draft.parseStatus === "needs_ocr" ||
    draft.parseStatus === "needs_review"
  ) {
    await updateAutomationState(draft.id, {
      workflow_status: "review_required",
      verification_status: "needs_review",
    });
    await recordAction({
      draftId: draft.id,
      sourceMessageId: draft.messageId,
      action: "review_required",
      newValue: { reason: draft.parseStatus },
    });
    if (!suppressReply) await trySendReviewNotice(draft, "needs_review");
    return "review_required";
  }

  if (draft.parseStatus !== "ready_for_review" || !draft.extractedText) {
    await updateAutomationState(draft.id, {
      workflow_status: "review_required",
      verification_status: "needs_review",
    });
    await recordAction({
      draftId: draft.id,
      sourceMessageId: draft.messageId,
      action: "review_required",
      newValue: { reason: "parser_not_ready" },
    });
    if (!suppressReply) await trySendReviewNotice(draft, "needs_review");
    return "review_required";
  }

  const candidate = verificationCandidate(draft);
  const deterministicDecision = verifyDocumentDeterministically(candidate);
  if (deterministicDecision.verified) {
    return recordVerifiedDraft(
      draft,
      {
        provider: "local",
        model: null,
        details: {
          verifier: "deterministic-v1",
          issues: [],
          matched_item_count: draft.items.length,
        },
      },
      suppressReply,
    );
  }

  try {
    const extraction = await extractDocumentWithGroq(draft.extractedText);
    const decision = compareDocumentVerification(candidate, extraction);

    if (!decision.verified) {
      await updateAutomationState(draft.id, {
        workflow_status: "review_required",
        verification_status: "needs_review",
        verification_provider: "groq",
        verification_model: env.model,
        verification_details: {
          verifier: "strict-json-v1",
          deterministic_issues: deterministicDecision.issues,
          mismatches: decision.mismatches,
        },
      });
      await recordAction({
        draftId: draft.id,
        sourceMessageId: draft.messageId,
        action: "review_required",
        newValue: {
          deterministic_issues: deterministicDecision.issues,
          mismatches: decision.mismatches,
        },
      });
      if (!suppressReply) await trySendReviewNotice(draft, "needs_review");
      return "review_required";
    }

    return recordVerifiedDraft(
      draft,
      {
        provider: "groq",
        model: env.model,
        details: {
          verifier: "strict-json-v1",
          deterministic_issues: deterministicDecision.issues,
          matched_item_count: draft.items.length,
          mismatches: [],
        },
      },
      suppressReply,
    );
  } catch (error) {
    const safeReason =
      error instanceof Error ? error.message.slice(0, 180) : "Unknown error";

    await updateAutomationState(draft.id, {
      workflow_status: "review_required",
      verification_status: "failed",
      verification_provider: "groq",
      verification_model: env.model,
      verification_details: {
        verifier: "strict-json-v1",
        error: safeReason,
      },
    });
    await recordAction({
      draftId: draft.id,
      sourceMessageId: draft.messageId,
      action: "automation_failed",
      newValue: { error: safeReason },
    });
    if (!suppressReply) await trySendReviewNotice(draft, "verification_failed");
    return "review_required";
  }
}

function editRows(draft: DraftContext) {
  const rows = [
    {
      id: "so:doc:field:document_number:" + draft.id,
      title: "ബിൽ നമ്പർ",
      description: trimForWhatsApp(
        draft.documentNumber ?? "കണ്ടെത്തിയില്ല",
        60,
      ),
    },
    {
      id: "so:doc:field:vehicle_number:" + draft.id,
      title: "വാഹന നമ്പർ",
      description: trimForWhatsApp(draft.vehicleNumber ?? "കണ്ടെത്തിയില്ല", 60),
    },
  ];

  for (const [index, item] of draft.items.slice(0, EDIT_ITEM_LIMIT).entries()) {
    rows.push({
      id: "so:doc:qty:" + draft.id + ":" + item.id,
      title: "അളവ് സാധനം " + String(index + 1),
      description: trimForWhatsApp(
        item.description +
          " — " +
          formatQuantity(item.quantity) +
          (item.unit ? " " + item.unit : ""),
        70,
      ),
    });
  }

  return rows.slice(0, 10);
}

async function startEditSession(input: {
  draft: DraftContext;
  senderPhone: string;
  targetKind: "document_number" | "vehicle_number" | "item_quantity";
  targetItemId?: string | null;
  sourceMessageId: string;
}) {
  const supabase = getSupabaseAdmin();
  const expiresAt = new Date(
    Date.now() + EDIT_SESSION_MINUTES * 60 * 1000,
  ).toISOString();

  const { error } = await supabase.from("document_edit_sessions").upsert(
    {
      sender_phone: input.senderPhone,
      draft_id: input.draft.id,
      target_kind: input.targetKind,
      target_item_id: input.targetItemId ?? null,
      expires_at: expiresAt,
    },
    { onConflict: "sender_phone" },
  );

  if (error) {
    throw new Error("Failed to start document edit session: " + error.message);
  }

  await recordAction({
    draftId: input.draft.id,
    sourceMessageId: input.sourceMessageId,
    action: "edit_requested",
    fieldKey:
      input.targetKind === "item_quantity"
        ? "item_quantity:" + input.targetItemId
        : input.targetKind,
  });

  const label =
    input.targetKind === "document_number"
      ? "ബിൽ നമ്പർ"
      : input.targetKind === "vehicle_number"
        ? "വാഹന നമ്പർ"
        : "സാധനത്തിന്റെ അളവ്";

  await sendOpsReplyButtons({
    requestId: deterministicUuid(
      "document-edit-prompt:" + input.sourceMessageId,
    ),
    replyToMessageId: input.sourceMessageId,
    body:
      "ശരിയായ " +
      label +
      " മാത്രം അടുത്ത മെസേജായി അയക്കുക. ഈ തിരുത്തൽ " +
      String(EDIT_SESSION_MINUTES) +
      " മിനിറ്റിന് ശേഷം കാലഹരണപ്പെടും.",
    buttons: [
      {
        id: "so:doc:edit_cancel:" + input.draft.id,
        title: "റദ്ദാക്കുക",
      },
    ],
  });
}

async function cancelEditSession(senderPhone: string, draftId: string) {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("document_edit_sessions")
    .delete()
    .eq("sender_phone", senderPhone)
    .eq("draft_id", draftId);

  if (error) {
    throw new Error("Failed to cancel document edit session: " + error.message);
  }
}

async function applyPendingTextEdit(
  message: NormalizedWhatsAppMessage,
  storedMessageId: string,
): Promise<boolean> {
  if (message.type !== "text" || !message.textBody) return false;

  const supabase = getSupabaseAdmin();
  const { data: session, error: sessionError } = await supabase
    .from("document_edit_sessions")
    .select("draft_id, target_kind, target_item_id, expires_at")
    .eq("sender_phone", message.senderPhone)
    .maybeSingle();

  if (sessionError) {
    throw new Error(
      "Failed to inspect document edit session: " + sessionError.message,
    );
  }
  if (!session) return false;

  const draft = await assertDraftSender(session.draft_id, message.senderPhone);

  if (new Date(session.expires_at).getTime() < Date.now()) {
    await cancelEditSession(message.senderPhone, draft.id);
    await sendOpsReply({
      requestId: deterministicUuid(
        "document-edit-expired:" + message.messageId,
      ),
      replyToMessageId: storedMessageId,
      body: "തിരുത്താനുള്ള സമയം കഴിഞ്ഞു. ബിൽ സംഗ്രഹത്തിലെ തിരുത്തുക അമർത്തി വീണ്ടും ശ്രമിക്കുക.",
    });
    return true;
  }

  const targetKind = session.target_kind as
    "document_number" | "vehicle_number" | "item_quantity";
  const corrected = normalizeCorrectionValue(targetKind, message.textBody);

  if (corrected === null) {
    await sendOpsReplyButtons({
      requestId: deterministicUuid(
        "document-edit-invalid:" + message.messageId,
      ),
      replyToMessageId: storedMessageId,
      body: "ഈ വിവരത്തിന് നൽകിയ വില ശരിയല്ല. ശരിയായ വില മാത്രം അയക്കുക, അല്ലെങ്കിൽ തിരുത്തൽ റദ്ദാക്കുക.",
      buttons: [
        {
          id: "so:doc:edit_cancel:" + draft.id,
          title: "റദ്ദാക്കുക",
        },
      ],
    });
    return true;
  }

  let previousValue: unknown;

  if (targetKind === "item_quantity") {
    if (!session.target_item_id) {
      throw new Error("Item quantity edit is missing its target item");
    }

    const { data: item, error: itemReadError } = await supabase
      .from("document_items")
      .select("quantity")
      .eq("id", session.target_item_id)
      .eq("draft_id", draft.id)
      .maybeSingle();

    if (itemReadError) {
      throw new Error("Failed to load edited item: " + itemReadError.message);
    }
    if (!item) {
      throw new Error("Edited item was not found");
    }

    previousValue = item.quantity === null ? null : Number(item.quantity);

    if (draft.stockStatus === "applied") {
      const stockCorrection = await applyStockQuantityCorrection({
        draftId: draft.id,
        itemId: session.target_item_id,
        quantity: Number(corrected),
        actionKey: deterministicUuid(
          "stock-edit:" +
            message.messageId +
            ":" +
            draft.id +
            ":" +
            session.target_item_id,
        ),
      });

      if (stockCorrection.status === "insufficient_stock") {
        await sendOpsReplyButtons({
          requestId: deterministicUuid(
            "stock-edit-insufficient:" + message.messageId,
          ),
          replyToMessageId: storedMessageId,
          body:
            "❌ ആവശ്യത്തിന് സ്റ്റോക്ക് ഇല്ലാത്തതിനാൽ അളവിലെ തിരുത്തൽ സേവ് ചെയ്തില്ല. അധികമായി വേണ്ടത്: " +
            String(stockCorrection.required ?? 0) +
            ", ലഭ്യമായത്: " +
            String(stockCorrection.available ?? 0) +
            ". മറ്റൊരു അളവ് അയക്കുക, അല്ലെങ്കിൽ റദ്ദാക്കുക.",
          buttons: [
            {
              id: "so:doc:edit_cancel:" + draft.id,
              title: "റദ്ദാക്കുക",
            },
          ],
        });
        return true;
      }

      if (
        stockCorrection.status !== "corrected" &&
        stockCorrection.status !== "already_corrected"
      ) {
        throw new Error(
          "Stock correction was not applied safely: " + stockCorrection.status,
        );
      }
    } else {
      const { error: itemUpdateError } = await supabase
        .from("document_items")
        .update({ quantity: corrected })
        .eq("id", session.target_item_id)
        .eq("draft_id", draft.id);

      if (itemUpdateError) {
        throw new Error(
          "Failed to update item quantity: " + itemUpdateError.message,
        );
      }
    }
  } else {
    const column =
      targetKind === "document_number" ? "document_number" : "vehicle_number";
    previousValue =
      targetKind === "document_number"
        ? draft.documentNumber
        : draft.vehicleNumber;

    const { error: draftUpdateError } = await supabase
      .from("document_drafts")
      .update({ [column]: corrected })
      .eq("id", draft.id);

    if (draftUpdateError) {
      throw new Error(
        "Failed to update document field: " + draftUpdateError.message,
      );
    }
  }

  const now = new Date().toISOString();
  await updateAutomationState(draft.id, {
    parse_status: "approved",
    approved_at: now,
    workflow_status: "recorded",
    verification_status: "manual_override",
  });

  await recordAction({
    draftId: draft.id,
    sourceMessageId: storedMessageId,
    action: "edit_applied",
    fieldKey:
      targetKind === "item_quantity"
        ? "item_quantity:" + session.target_item_id
        : targetKind,
    previousValue,
    newValue: corrected,
  });

  await cancelEditSession(message.senderPhone, draft.id);

  let updatedDraft = await loadDraftContext(draft.id);
  if (!updatedDraft) {
    throw new Error("Updated document draft was not found");
  }

  if (updatedDraft.stockStatus !== "applied") {
    try {
      await processStockForDraft({
        draftId: updatedDraft.id,
        replyToMessageId: storedMessageId,
        notifySuccess: false,
      });
      updatedDraft = (await loadDraftContext(draft.id)) ?? updatedDraft;
    } catch (error) {
      console.warn("Stock retry after bill correction did not complete", {
        reason:
          error instanceof Error
            ? error.message.slice(0, 180)
            : "Unknown stock error",
      });
    }
  }

  await sendSummary(
    updatedDraft,
    storedMessageId,
    "document-summary-after-edit:" + message.messageId,
    "✅ തിരുത്തൽ സേവ് ചെയ്തു",
  );
  return true;
}

async function handleInteractiveAction(
  message: NormalizedWhatsAppMessage,
  storedMessageId: string,
): Promise<boolean> {
  const action = message.interactiveReply
    ? parseDocumentWorkflowAction(message.interactiveReply.id)
    : null;
  if (!action) return false;

  const draft = await assertDraftSender(action.draftId, message.senderPhone);

  if (action.type === "edit") {
    if (draft.workflowStatus === "cancelled") {
      await sendOpsReply({
        requestId: deterministicUuid(
          "document-edit-cancelled:" + message.messageId,
        ),
        replyToMessageId: storedMessageId,
        body: "ഈ ബിൽ നിലവിലെ പ്രവർത്തന പട്ടികയിൽ നിന്ന് ഇതിനകം ഒഴിവാക്കിയിട്ടുണ്ട്.",
      });
      return true;
    }

    await sendOpsList({
      requestId: deterministicUuid("document-edit-list:" + message.messageId),
      replyToMessageId: storedMessageId,
      body: "തിരുത്തേണ്ടത് തിരഞ്ഞെടുക്കുക. അതിന് ശേഷം പുതിയ വില മാത്രം ടൈപ്പ് ചെയ്താൽ മതി.",
      buttonText: "തിരഞ്ഞെടുക്കുക",
      rows: editRows(draft),
    });
    return true;
  }

  if (action.type === "delete") {
    await sendOpsReplyButtons({
      requestId: deterministicUuid(
        "document-delete-confirm:" + message.messageId,
      ),
      replyToMessageId: storedMessageId,
      body: "ഈ ബിൽ നിലവിലെ പ്രവർത്തന പട്ടികയിൽ നിന്ന് ഒഴിവാക്കണോ? സ്റ്റോക്ക് കുറച്ചിട്ടുണ്ടെങ്കിൽ അത് തിരികെ ചേർക്കും. പഴയ രേഖകൾ സുരക്ഷിതമായി നിലനിർത്തും.",
      buttons: [
        {
          id: "so:doc:delete_confirm:" + draft.id,
          title: "അതെ, ഒഴിവാക്കുക",
        },
        {
          id: "so:doc:delete_keep:" + draft.id,
          title: "വേണ്ട",
        },
      ],
    });
    return true;
  }

  if (action.type === "delete_confirm") {
    let stockWasReversed = false;

    if (draft.stockStatus === "applied") {
      const reversal = await reverseStockForDraft(draft.id);
      if (
        reversal.status !== "reversed" &&
        reversal.status !== "already_reversed"
      ) {
        await sendOpsReply({
          requestId: deterministicUuid(
            "document-delete-stock-blocked:" + message.messageId,
          ),
          replyToMessageId: storedMessageId,
          body: "⚠️ സ്റ്റോക്ക് സുരക്ഷിതമായി തിരികെ ചേർക്കാൻ കഴിഞ്ഞില്ല. അതിനാൽ ബിൽ ഒഴിവാക്കിയിട്ടില്ല; വിവരങ്ങളിൽ മാറ്റമൊന്നും വരുത്തിയിട്ടില്ല.",
        });
        return true;
      }
      stockWasReversed = true;
    }

    await updateAutomationState(draft.id, {
      workflow_status: "cancelled",
    });
    await cancelEditSession(message.senderPhone, draft.id);
    await recordAction({
      draftId: draft.id,
      sourceMessageId: storedMessageId,
      action: "cancelled",
    });
    await sendOpsReply({
      requestId: deterministicUuid("document-deleted:" + message.messageId),
      replyToMessageId: storedMessageId,
      body:
        "🗑️ ബിൽ നിലവിലെ പ്രവർത്തന പട്ടികയിൽ നിന്ന് ഒഴിവാക്കി. പഴയ രേഖകൾ നിലനിർത്തിയിട്ടുണ്ട്." +
        (stockWasReversed
          ? " മുമ്പ് കുറച്ച സ്റ്റോക്ക് തിരികെ ചേർത്തു."
          : " ഈ ബില്ലിനായി സ്റ്റോക്ക് കുറച്ചിട്ടില്ലായിരുന്നു."),
    });
    return true;
  }

  if (action.type === "delete_keep") {
    await sendOpsReply({
      requestId: deterministicUuid("document-kept:" + message.messageId),
      replyToMessageId: storedMessageId,
      body: "ബിൽ നിലനിർത്തി. മാറ്റമൊന്നും വരുത്തിയിട്ടില്ല.",
    });
    return true;
  }

  if (action.type === "edit_cancel") {
    await cancelEditSession(message.senderPhone, draft.id);
    await sendOpsReply({
      requestId: deterministicUuid("document-edit-cancel:" + message.messageId),
      replyToMessageId: storedMessageId,
      body: "തിരുത്തൽ റദ്ദാക്കി. മാറ്റമൊന്നും വരുത്തിയിട്ടില്ല.",
    });
    return true;
  }

  if (action.type === "edit_field") {
    await startEditSession({
      draft,
      senderPhone: message.senderPhone,
      targetKind: action.field,
      sourceMessageId: storedMessageId,
    });
    return true;
  }

  if (action.type === "edit_item_quantity") {
    if (!draft.items.some((item) => item.id === action.itemId)) {
      throw new Error("Edited item does not belong to this document");
    }

    await startEditSession({
      draft,
      senderPhone: message.senderPhone,
      targetKind: "item_quantity",
      targetItemId: action.itemId,
      sourceMessageId: storedMessageId,
    });
    return true;
  }

  return false;
}

export async function handleDocumentWorkflowInbound(
  message: NormalizedWhatsAppMessage,
  storedMessageId: string,
  options: { fromVoice?: boolean } = {},
): Promise<"handled" | "ignored"> {
  if (
    (await handleTripWorkflowInbound(message, storedMessageId)) === "handled"
  ) {
    return "handled";
  }

  if (
    (await handleStockWorkflowInbound(message, storedMessageId)) === "handled"
  ) {
    return "handled";
  }

  if (await handleInteractiveAction(message, storedMessageId)) {
    return "handled";
  }

  if (await applyPendingTextEdit(message, storedMessageId)) {
    return "handled";
  }

  if ((await handleFastWhatsAppQuery(message, storedMessageId, options)) === "handled") {
    return "handled";
  }

  return "ignored";
}
