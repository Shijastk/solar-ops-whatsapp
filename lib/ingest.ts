import { handleDocumentWorkflowInbound } from "@/lib/document-automation";
import { getIngestionEnv } from "@/lib/env";
import { processStoredWhatsAppMedia } from "@/lib/media-processing";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type { NormalizedWhatsAppMessage } from "@/lib/whatsapp";

const MEDIA_TYPES = new Set([
  "document",
  "image",
  "audio",
  "video",
  "sticker",
]);

export async function ingestWhatsAppMessage(
  message: NormalizedWhatsAppMessage,
): Promise<"stored" | "ignored"> {
  const env = getIngestionEnv();

  if (
    env.allowedSenders.size > 0 &&
    !env.allowedSenders.has(message.senderPhone.replace(/\D/g, ""))
  ) {
    console.info("WhatsApp message ignored", { reason: "sender_allowlist" });
    return "ignored";
  }

  if (
    env.WHATSAPP_PHONE_NUMBER_ID &&
    message.phoneNumberId &&
    message.phoneNumberId !== env.WHATSAPP_PHONE_NUMBER_ID
  ) {
    console.info("WhatsApp message ignored", { reason: "phone_number_id" });
    return "ignored";
  }

  const supabase = getSupabaseAdmin();

  const baseRow = {
    whatsapp_message_id: message.messageId,
    waba_id: message.wabaId ?? null,
    phone_number_id: message.phoneNumberId ?? null,
    display_phone_number: message.displayPhoneNumber ?? null,
    sender_phone: message.senderPhone,
    sender_name: message.senderName ?? null,
    message_type: message.type,
    text_body: message.textBody ?? null,
    media_id: message.media?.id ?? null,
    original_filename: message.media?.filename ?? null,
    mime_type: message.media?.mimeType ?? null,
    media_sha256: message.media?.sha256 ?? null,
    received_at: message.timestamp.toISOString(),
    processing_status:
      message.media && MEDIA_TYPES.has(message.type) ? "received" : "stored",
    error_message: null,
  };

  const { data: persistedMessage, error: upsertError } = await supabase
    .from("whatsapp_messages")
    .upsert(baseRow, {
      onConflict: "whatsapp_message_id",
    })
    .select("id")
    .single();

  if (upsertError || !persistedMessage) {
    throw new Error(
      `Failed to persist WhatsApp message: ${upsertError?.message ?? "missing message row"}`,
    );
  }

  if (!message.media || !MEDIA_TYPES.has(message.type)) {
    try {
      await handleDocumentWorkflowInbound(message, persistedMessage.id);
    } catch (error) {
      console.warn("WhatsApp document workflow interaction did not complete", {
        messageStored: true,
        reason:
          error instanceof Error
            ? error.message.slice(0, 180)
            : "Unknown workflow error",
      });
    }

    return "stored";
  }

  await processStoredWhatsAppMedia(persistedMessage.id);
  return "stored";
}
