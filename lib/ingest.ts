import { createHash } from "node:crypto";
import { extname } from "node:path";
import { getIngestionEnv } from "@/lib/env";
import { downloadWhatsAppMedia } from "@/lib/meta";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type { NormalizedWhatsAppMessage } from "@/lib/whatsapp";

const MEDIA_TYPES = new Set([
  "document",
  "image",
  "audio",
  "video",
  "sticker",
]);

function cleanFilename(value: string): string {
  const base = value
    .normalize("NFKC")
    .replace(/[\\/]/g, "_")
    .replace(/[^\p{L}\p{N}._ -]/gu, "_")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "");

  return base.slice(0, 120) || "media";
}

function extensionForMime(mimeType: string): string {
  const known: Record<string, string> = {
    "application/pdf": ".pdf",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "audio/ogg": ".ogg",
    "audio/mpeg": ".mp3",
    "video/mp4": ".mp4",
  };

  return known[mimeType.toLowerCase()] ?? "";
}

function buildStoragePath(
  message: NormalizedWhatsAppMessage,
  filename: string,
): string {
  const year = message.timestamp.getUTCFullYear();
  const month = String(message.timestamp.getUTCMonth() + 1).padStart(2, "0");
  const safeMessageId = createHash("sha256")
    .update(message.messageId)
    .digest("hex")
    .slice(0, 24);

  return [
    cleanFilename(message.senderPhone),
    String(year),
    month,
    safeMessageId,
    filename,
  ].join("/");
}

export async function ingestWhatsAppMessage(
  message: NormalizedWhatsAppMessage,
): Promise<"stored" | "ignored"> {
  const env = getIngestionEnv();

  if (
    env.allowedSenders.size > 0 &&
    !env.allowedSenders.has(message.senderPhone.replace(/\D/g, ""))
  ) {
    return "ignored";
  }

  if (
    env.WHATSAPP_PHONE_NUMBER_ID &&
    message.phoneNumberId &&
    message.phoneNumberId !== env.WHATSAPP_PHONE_NUMBER_ID
  ) {
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
    received_at: message.timestamp.toISOString(),
    processing_status:
      message.media && MEDIA_TYPES.has(message.type) ? "received" : "stored",
    error_message: null,
  };

  const { error: upsertError } = await supabase
    .from("whatsapp_messages")
    .upsert(baseRow, {
      onConflict: "whatsapp_message_id",
    });

  if (upsertError) {
    throw new Error(`Failed to persist WhatsApp message: ${upsertError.message}`);
  }

  if (!message.media || !MEDIA_TYPES.has(message.type)) {
    return "stored";
  }

  try {
    const media = await downloadWhatsAppMedia(
      message.media.id,
      message.media.mimeType,
    );

    const sourceFilename =
      message.media.filename ??
      `${message.type}-${message.media.id}${extensionForMime(media.mimeType)}`;

    const originalExtension = extname(sourceFilename);
    const normalizedFilename = cleanFilename(
      originalExtension
        ? sourceFilename
        : `${sourceFilename}${extensionForMime(media.mimeType)}`,
    );

    const storagePath = buildStoragePath(message, normalizedFilename);

    const { error: uploadError } = await supabase.storage
      .from(env.SUPABASE_STORAGE_BUCKET)
      .upload(storagePath, media.bytes, {
        contentType: media.mimeType,
        upsert: true,
      });

    if (uploadError) {
      throw new Error(`Supabase Storage upload failed: ${uploadError.message}`);
    }

    const { error: updateError } = await supabase
      .from("whatsapp_messages")
      .update({
        storage_path: storagePath,
        mime_type: media.mimeType,
        media_sha256: media.sha256 ?? message.media.sha256 ?? null,
        media_size_bytes: media.fileSize,
        processing_status: "stored",
        processed_at: new Date().toISOString(),
        error_message: null,
      })
      .eq("whatsapp_message_id", message.messageId);

    if (updateError) {
      throw new Error(
        `Failed to finalize WhatsApp message: ${updateError.message}`,
      );
    }

    return "stored";
  } catch (error) {
    const messageText =
      error instanceof Error ? error.message.slice(0, 1000) : "Unknown error";

    await supabase
      .from("whatsapp_messages")
      .update({
        processing_status: "failed",
        error_message: messageText,
        processed_at: new Date().toISOString(),
      })
      .eq("whatsapp_message_id", message.messageId);

    throw error;
  }
}
