import { createHash } from "node:crypto";
import { extname } from "node:path";
import { runDocumentAutomationForDraft } from "@/lib/document-automation";
import { processPdfBytesForMessage } from "@/lib/document-processing";
import { getIngestionEnv } from "@/lib/env";
import { downloadWhatsAppMedia } from "@/lib/meta";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

type StoredMediaRow = {
  id: string;
  whatsapp_message_id: string;
  sender_phone: string;
  message_type: string;
  media_id: string | null;
  original_filename: string | null;
  mime_type: string | null;
  media_sha256: string | null;
  received_at: string;
  storage_path: string | null;
};

export type StoredMediaProcessingResult = {
  reusedStoredBytes: boolean;
  storagePath: string;
  mimeType: string;
  documentResult: string | null;
};

export function cleanInboundFilename(value: string): string {
  const base = value
    .normalize("NFKC")
    .replace(/[\\/]/g, "_")
    .replace(/[^\p{L}\p{N}._ -]/gu, "_")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "");

  return base.slice(0, 120) || "media";
}

export function extensionForInboundMime(mimeType: string): string {
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

export function buildInboundStoragePath(input: {
  senderPhone: string;
  receivedAt: Date;
  whatsappMessageId: string;
  filename: string;
}): string {
  const year = input.receivedAt.getUTCFullYear();
  const month = String(input.receivedAt.getUTCMonth() + 1).padStart(2, "0");
  const safeMessageId = createHash("sha256")
    .update(input.whatsappMessageId)
    .digest("hex")
    .slice(0, 24);

  return [
    cleanInboundFilename(input.senderPhone),
    String(year),
    month,
    safeMessageId,
    input.filename,
  ].join("/");
}

export function isPdfInboundMedia(input: {
  mimeType: string | null;
  originalFilename: string | null;
}): boolean {
  return (
    input.mimeType?.toLowerCase() === "application/pdf" ||
    Boolean(input.originalFilename?.toLowerCase().endsWith(".pdf"))
  );
}

async function loadStoredMediaRow(messageId: string): Promise<StoredMediaRow> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("whatsapp_messages")
    .select(
      "id, whatsapp_message_id, sender_phone, message_type, media_id, original_filename, mime_type, media_sha256, received_at, storage_path",
    )
    .eq("id", messageId)
    .maybeSingle();

  if (error) {
    throw new Error("Failed to load stored WhatsApp media: " + error.message);
  }
  if (!data) {
    throw new Error("Stored WhatsApp media row was not found");
  }

  return data as StoredMediaRow;
}

async function downloadPrivateStoredBytes(storagePath: string): Promise<Buffer | null> {
  const env = getIngestionEnv();
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.storage
    .from(env.SUPABASE_STORAGE_BUCKET)
    .download(storagePath);

  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

async function updateStoredMedia(input: {
  messageId: string;
  storagePath: string;
  mimeType: string;
  sha256: string | null;
  fileSize: number;
}) {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("whatsapp_messages")
    .update({
      storage_path: input.storagePath,
      mime_type: input.mimeType,
      media_sha256: input.sha256,
      media_size_bytes: input.fileSize,
      processing_status: "stored",
      processed_at: new Date().toISOString(),
      error_message: null,
    })
    .eq("id", input.messageId);

  if (error) {
    throw new Error("Failed to finalize WhatsApp message: " + error.message);
  }
}

async function markStoredMediaFailed(messageId: string, error: unknown) {
  const message =
    error instanceof Error ? error.message.slice(0, 1000) : "Unknown error";

  const supabase = getSupabaseAdmin();
  await supabase
    .from("whatsapp_messages")
    .update({
      processing_status: "failed",
      error_message: message,
      processed_at: new Date().toISOString(),
    })
    .eq("id", messageId);
}

async function obtainMediaBytes(row: StoredMediaRow): Promise<{
  bytes: Buffer;
  storagePath: string;
  mimeType: string;
  sha256: string | null;
  reusedStoredBytes: boolean;
}> {
  const env = getIngestionEnv();
  const supabase = getSupabaseAdmin();

  if (row.storage_path) {
    const storedBytes = await downloadPrivateStoredBytes(row.storage_path);
    if (storedBytes) {
      return {
        bytes: storedBytes,
        storagePath: row.storage_path,
        mimeType: row.mime_type ?? "application/octet-stream",
        sha256: createHash("sha256").update(storedBytes).digest("hex"),
        reusedStoredBytes: true,
      };
    }
  }

  if (!row.media_id) {
    throw new Error("Stored WhatsApp media has no media id for recovery");
  }

  const media = await downloadWhatsAppMedia(row.media_id, row.mime_type ?? undefined);
  const sourceFilename =
    row.original_filename ??
    `${row.message_type}-${row.media_id}${extensionForInboundMime(media.mimeType)}`;
  const originalExtension = extname(sourceFilename);
  const normalizedFilename = cleanInboundFilename(
    originalExtension
      ? sourceFilename
      : `${sourceFilename}${extensionForInboundMime(media.mimeType)}`,
  );
  const storagePath =
    row.storage_path ??
    buildInboundStoragePath({
      senderPhone: row.sender_phone,
      receivedAt: new Date(row.received_at),
      whatsappMessageId: row.whatsapp_message_id,
      filename: normalizedFilename,
    });

  const { error: uploadError } = await supabase.storage
    .from(env.SUPABASE_STORAGE_BUCKET)
    .upload(storagePath, media.bytes, {
      contentType: media.mimeType,
      upsert: true,
    });

  if (uploadError) {
    throw new Error("Supabase Storage upload failed: " + uploadError.message);
  }

  return {
    bytes: media.bytes,
    storagePath,
    mimeType: media.mimeType,
    sha256: media.sha256 ?? row.media_sha256 ?? null,
    reusedStoredBytes: false,
  };
}

export async function processStoredWhatsAppMedia(
  messageId: string,
): Promise<StoredMediaProcessingResult> {
  try {
    const row = await loadStoredMediaRow(messageId);
    const media = await obtainMediaBytes(row);

    await updateStoredMedia({
      messageId: row.id,
      storagePath: media.storagePath,
      mimeType: media.mimeType,
      sha256: media.sha256,
      fileSize: media.bytes.byteLength,
    });

    let documentResult: string | null = null;

    if (
      isPdfInboundMedia({
        mimeType: media.mimeType,
        originalFilename: row.original_filename,
      })
    ) {
      try {
        const parsed = await processPdfBytesForMessage(row.id, media.bytes);
        console.info("WhatsApp PDF parse summary", {
          status: parsed.status,
          itemCount: parsed.itemCount,
          skippedApproved: parsed.skippedApproved,
        });

        try {
          const automationResult = await runDocumentAutomationForDraft(
            parsed.draftId,
          );
          documentResult = automationResult;
          console.info("WhatsApp document automation summary", {
            result: automationResult,
          });
        } catch (error) {
          console.warn("WhatsApp document automation did not complete", {
            messageStored: true,
            reason:
              error instanceof Error
                ? error.message.slice(0, 180)
                : "Unknown automation error",
          });
        }
      } catch {
        console.warn("WhatsApp PDF parsing did not complete", {
          messageStored: true,
        });
      }
    }

    return {
      reusedStoredBytes: media.reusedStoredBytes,
      storagePath: media.storagePath,
      mimeType: media.mimeType,
      documentResult,
    };
  } catch (error) {
    await markStoredMediaFailed(messageId, error);
    throw error;
  }
}
