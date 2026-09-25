import { createHash } from "node:crypto";
import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

const opsMessageSchema = z.object({
  id: z.string().uuid(),
  whatsapp_message_id: z.string(),
  sender_phone: z.string(),
  sender_name: z.string().nullable(),
  message_type: z.string(),
  text_body: z.string().nullable(),
  original_filename: z.string().nullable(),
  mime_type: z.string().nullable(),
  media_size_bytes: z.coerce.number().nullable(),
  storage_path: z.string().nullable(),
  processing_status: z.string(),
  received_at: z.string(),
  processed_at: z.string().nullable(),
});

const documentItemSchema = z.object({
  id: z.string().uuid(),
  draft_id: z.string().uuid(),
  line_index: z.number(),
  source_line_number: z.number().nullable(),
  description: z.string(),
  normalized_description: z.string(),
  hsn_sac: z.string().nullable(),
  quantity: z.coerce.number().nullable(),
  unit: z.string().nullable(),
  rate: z.coerce.number().nullable(),
  amount: z.coerce.number().nullable(),
});

const documentDraftSchema = z.object({
  id: z.string().uuid(),
  message_id: z.string().uuid(),
  parser_version: z.string(),
  parse_status: z.string(),
  document_type: z.string().nullable(),
  supplier_name: z.string().nullable(),
  supplier_gstin: z.string().nullable(),
  supplier_address: z.string().nullable(),
  document_number: z.string().nullable(),
  document_date: z.string().nullable(),
  eway_bill_number: z.string().nullable(),
  consignee_name: z.string().nullable(),
  consignee_address: z.string().nullable(),
  consignee_gstin: z.string().nullable(),
  consignee_pincode: z.string().nullable(),
  consignee_phone: z.string().nullable(),
  buyer_name: z.string().nullable(),
  buyer_address: z.string().nullable(),
  buyer_gstin: z.string().nullable(),
  buyer_pincode: z.string().nullable(),
  buyer_phone: z.string().nullable(),
  destination: z.string().nullable(),
  dispatch_from_address: z.string().nullable(),
  vehicle_number: z.string().nullable(),
  approximate_distance_km: z.number().nullable(),
  eway_generated_at_text: z.string().nullable(),
  eway_valid_until_text: z.string().nullable(),
  supply_type: z.string().nullable(),
  transaction_type: z.string().nullable(),
  taxable_amount: z.coerce.number().nullable(),
  cgst_amount: z.coerce.number().nullable(),
  sgst_amount: z.coerce.number().nullable(),
  total_amount: z.coerce.number().nullable(),
  page_count: z.number().nullable(),
  text_length: z.number().nullable(),
  missing_fields: z.array(z.string()),
  parse_error: z.string().nullable(),
  extracted_at: z.string(),
  approved_at: z.string().nullable(),
  verification_status: z.string(),
  verification_provider: z.string().nullable(),
  verification_model: z.string().nullable(),
  workflow_status: z.string(),
  summary_sent_at: z.string().nullable(),
});

const outboundMessageSchema = z.object({
  id: z.string().uuid(),
  reply_to_message_id: z.string().uuid().nullable(),
  recipient_phone: z.string(),
  body: z.string(),
  message_kind: z.string(),
  status: z.string(),
  sent_at: z.string().nullable(),
  status_updated_at: z.string().nullable(),
  error_message: z.string().nullable(),
  created_at: z.string(),
});

export type OpsMessage = z.infer<typeof opsMessageSchema>;
export type OpsDocumentItem = z.infer<typeof documentItemSchema>;
export type OpsDocumentDraft = z.infer<typeof documentDraftSchema> & {
  items: OpsDocumentItem[];
};
export type OpsOutboundMessage = z.infer<typeof outboundMessageSchema>;

export type OpsSummary = {
  totalMessages: number;
  storedMessages: number;
  availableFiles: number;
  failedMessages: number;
  reviewDrafts: number;
};

export type OpsConversation = {
  key: string;
  senderPhone: string;
  senderName: string | null;
  latestReceivedAt: string;
  messages: OpsMessage[];
  outbound: OpsOutboundMessage[];
};

const MESSAGE_SELECT = [
  "id",
  "whatsapp_message_id",
  "sender_phone",
  "sender_name",
  "message_type",
  "text_body",
  "original_filename",
  "mime_type",
  "media_size_bytes",
  "storage_path",
  "processing_status",
  "received_at",
  "processed_at",
].join(",");

const DRAFT_SELECT = [
  "id",
  "message_id",
  "parser_version",
  "parse_status",
  "document_type",
  "supplier_name",
  "supplier_gstin",
  "supplier_address",
  "document_number",
  "document_date",
  "eway_bill_number",
  "consignee_name",
  "consignee_address",
  "consignee_gstin",
  "consignee_pincode",
  "consignee_phone",
  "buyer_name",
  "buyer_address",
  "buyer_gstin",
  "buyer_pincode",
  "buyer_phone",
  "destination",
  "dispatch_from_address",
  "vehicle_number",
  "approximate_distance_km",
  "eway_generated_at_text",
  "eway_valid_until_text",
  "supply_type",
  "transaction_type",
  "taxable_amount",
  "cgst_amount",
  "sgst_amount",
  "total_amount",
  "page_count",
  "text_length",
  "missing_fields",
  "parse_error",
  "extracted_at",
  "approved_at",
  "verification_status",
  "verification_provider",
  "verification_model",
  "workflow_status",
  "summary_sent_at",
].join(",");

export function conversationKey(senderPhone: string): string {
  return createHash("sha256").update(senderPhone).digest("hex").slice(0, 16);
}

export async function listOpsMessages(limit = 150): Promise<OpsMessage[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("whatsapp_messages")
    .select(MESSAGE_SELECT)
    .order("received_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error("Failed to load WhatsApp messages: " + error.message);
  }

  return z.array(opsMessageSchema).parse(data ?? []);
}

export async function listOpsOutboundMessages(
  limit = 250,
): Promise<OpsOutboundMessage[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("whatsapp_outbound_messages")
    .select(
      "id, reply_to_message_id, recipient_phone, body, message_kind, status, sent_at, status_updated_at, error_message, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error("Failed to load outbound messages: " + error.message);
  }

  return z.array(outboundMessageSchema).parse(data ?? []);
}

export async function listOpsDraftsForMessages(
  messageIds: string[],
): Promise<Map<string, OpsDocumentDraft>> {
  const output = new Map<string, OpsDocumentDraft>();
  if (messageIds.length === 0) return output;

  const supabase = getSupabaseAdmin();
  const { data: draftData, error: draftError } = await supabase
    .from("document_drafts")
    .select(DRAFT_SELECT)
    .in("message_id", messageIds);

  if (draftError) {
    throw new Error("Failed to load document drafts: " + draftError.message);
  }

  const drafts = z.array(documentDraftSchema).parse(draftData ?? []);
  if (drafts.length === 0) return output;

  const { data: itemData, error: itemError } = await supabase
    .from("document_items")
    .select(
      "id, draft_id, line_index, source_line_number, description, normalized_description, hsn_sac, quantity, unit, rate, amount",
    )
    .in(
      "draft_id",
      drafts.map((draft) => draft.id),
    )
    .order("line_index", { ascending: true });

  if (itemError) {
    throw new Error("Failed to load document items: " + itemError.message);
  }

  const items = z.array(documentItemSchema).parse(itemData ?? []);
  const itemsByDraft = new Map<string, OpsDocumentItem[]>();

  for (const item of items) {
    const bucket = itemsByDraft.get(item.draft_id) ?? [];
    bucket.push(item);
    itemsByDraft.set(item.draft_id, bucket);
  }

  for (const draft of drafts) {
    output.set(draft.message_id, {
      ...draft,
      items: itemsByDraft.get(draft.id) ?? [],
    });
  }

  return output;
}

export function buildOpsConversations(
  messages: OpsMessage[],
  outbound: OpsOutboundMessage[],
): OpsConversation[] {
  const grouped = new Map<string, OpsMessage[]>();

  for (const message of messages) {
    const bucket = grouped.get(message.sender_phone) ?? [];
    bucket.push(message);
    grouped.set(message.sender_phone, bucket);
  }

  return Array.from(grouped.entries())
    .map(([senderPhone, inbound]) => {
      const sorted = [...inbound].sort(
        (left, right) =>
          new Date(left.received_at).getTime() -
          new Date(right.received_at).getTime(),
      );
      const latest = sorted[sorted.length - 1];

      return {
        key: conversationKey(senderPhone),
        senderPhone,
        senderName: latest.sender_name,
        latestReceivedAt: latest.received_at,
        messages: sorted,
        outbound: outbound
          .filter((message) => message.recipient_phone === senderPhone)
          .sort(
            (left, right) =>
              new Date(left.created_at).getTime() -
              new Date(right.created_at).getTime(),
          ),
      };
    })
    .sort(
      (left, right) =>
        new Date(right.latestReceivedAt).getTime() -
        new Date(left.latestReceivedAt).getTime(),
    );
}

export async function getOpsSummary(): Promise<OpsSummary> {
  const supabase = getSupabaseAdmin();

  const [
    totalResult,
    storedResult,
    availableResult,
    failedResult,
    reviewResult,
  ] = await Promise.all([
    supabase
      .from("whatsapp_messages")
      .select("id", { count: "exact", head: true }),
    supabase
      .from("whatsapp_messages")
      .select("id", { count: "exact", head: true })
      .eq("processing_status", "stored"),
    supabase
      .from("whatsapp_messages")
      .select("id", { count: "exact", head: true })
      .not("storage_path", "is", null),
    supabase
      .from("whatsapp_messages")
      .select("id", { count: "exact", head: true })
      .eq("processing_status", "failed"),
    supabase
      .from("document_drafts")
      .select("id", { count: "exact", head: true })
      .in("parse_status", ["ready_for_review", "needs_review"]),
  ]);

  const results = [
    ["total", totalResult],
    ["stored", storedResult],
    ["available files", availableResult],
    ["failed", failedResult],
    ["review drafts", reviewResult],
  ] as const;

  for (const [label, result] of results) {
    if (result.error) {
      throw new Error(
        "Failed to count " + label + " WhatsApp messages: " + result.error.message,
      );
    }
  }

  return {
    totalMessages: totalResult.count ?? 0,
    storedMessages: storedResult.count ?? 0,
    availableFiles: availableResult.count ?? 0,
    failedMessages: failedResult.count ?? 0,
    reviewDrafts: reviewResult.count ?? 0,
  };
}

export async function getOpsMessageById(
  id: string,
): Promise<OpsMessage | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("whatsapp_messages")
    .select(MESSAGE_SELECT)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error("Failed to load WhatsApp message: " + error.message);
  }

  return data ? opsMessageSchema.parse(data) : null;
}
