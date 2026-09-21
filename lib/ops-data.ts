import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

const opsMessageSchema = z.object({
  id: z.string().uuid(),
  sender_phone: z.string(),
  sender_name: z.string().nullable(),
  message_type: z.string(),
  text_body: z.string().nullable(),
  original_filename: z.string().nullable(),
  mime_type: z.string().nullable(),
  media_size_bytes: z.number().nullable(),
  storage_path: z.string().nullable(),
  processing_status: z.string(),
  received_at: z.string(),
  processed_at: z.string().nullable(),
});

export type OpsMessage = z.infer<typeof opsMessageSchema>;

export type OpsSummary = {
  totalMessages: number;
  storedMessages: number;
  availableFiles: number;
  failedMessages: number;
};

const MESSAGE_SELECT = [
  "id",
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

export async function listOpsMessages(limit = 100): Promise<OpsMessage[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("whatsapp_messages")
    .select(MESSAGE_SELECT)
    .order("received_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to load WhatsApp messages: ${error.message}`);
  }

  return z.array(opsMessageSchema).parse(data ?? []);
}

export async function getOpsSummary(): Promise<OpsSummary> {
  const supabase = getSupabaseAdmin();

  const [
    totalResult,
    storedResult,
    availableResult,
    failedResult,
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
  ]);

  const results = [
    ["total", totalResult],
    ["stored", storedResult],
    ["available files", availableResult],
    ["failed", failedResult],
  ] as const;

  for (const [label, result] of results) {
    if (result.error) {
      throw new Error(
        `Failed to count ${label} WhatsApp messages: ${result.error.message}`,
      );
    }
  }

  return {
    totalMessages: totalResult.count ?? 0,
    storedMessages: storedResult.count ?? 0,
    availableFiles: availableResult.count ?? 0,
    failedMessages: failedResult.count ?? 0,
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
    throw new Error(`Failed to load WhatsApp message: ${error.message}`);
  }

  return data ? opsMessageSchema.parse(data) : null;
}
