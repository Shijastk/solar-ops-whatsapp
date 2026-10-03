import { createHash } from "node:crypto";
import { extname } from "node:path";
import {
  handleDocumentWorkflowInbound,
  runDocumentAutomationForDraft,
} from "@/lib/document-automation";
import { processPdfBytesForMessage } from "@/lib/document-processing";
import { deterministicUuid } from "@/lib/idempotency";
import { getIngestionEnv } from "@/lib/env";
import { downloadWhatsAppMedia } from "@/lib/meta";
import { sendOpsReply } from "@/lib/replies";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  markTripDocumentProcessed,
  reserveTripDocument,
} from "@/lib/trips";
import { transcribeOperationalVoice } from "@/lib/voice-transcription";
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

async function sendUnsupportedMessageAck(
  message: NormalizedWhatsAppMessage,
  storedMessageId: string,
) {
  const labels: Record<string, string> = {
    image: "Image",
    video: "Video",
    sticker: "Sticker",
    document: "Document",
    location: "Location",
    contacts: "Contact",
    reaction: "Reaction",
  };

  const label = labels[message.type] ?? "Message";
  await sendOpsReply({
    requestId: deterministicUuid(
      "unsupported-message:" + message.messageId,
    ),
    replyToMessageId: storedMessageId,
    knownInboundAt: message.timestamp,
    body:
      label +
      " ലഭിച്ചു. PDF bill, text, അല്ലെങ്കിൽ voice message അയച്ചാൽ Solar Ops അത് process ചെയ്ത് മറുപടി നൽകും.",
  });
}

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

  const likelyPdfDocument =
    message.type === "document" &&
    (
      !message.media?.mimeType ||
      message.media.mimeType.toLowerCase().includes("pdf") ||
      message.media.filename?.toLowerCase().endsWith(".pdf")
    );
  let reservedTripId: string | null = null;

  if (likelyPdfDocument) {
    try {
      reservedTripId = await reserveTripDocument({
        senderPhone: message.senderPhone,
        messageId: persistedMessage.id,
      });
    } catch (error) {
      console.warn("Trip document reservation did not complete", {
        reason:
          error instanceof Error
            ? error.message.slice(0, 180)
            : "Unknown trip reservation error",
      });
    }
  }

  if (!message.media || !MEDIA_TYPES.has(message.type)) {
    let workflowResult: "handled" | "ignored" = "ignored";
    try {
      workflowResult = await handleDocumentWorkflowInbound(
        message,
        persistedMessage.id,
      );
    } catch (error) {
      console.warn("WhatsApp document workflow interaction did not complete", {
        messageStored: true,
        reason:
          error instanceof Error
            ? error.message.slice(0, 180)
            : "Unknown workflow error",
      });
    }

    if (workflowResult === "ignored") {
      try {
        await sendUnsupportedMessageAck(message, persistedMessage.id);
      } catch (error) {
        console.warn("WhatsApp unsupported-message acknowledgement failed", {
          reason:
            error instanceof Error
              ? error.message.slice(0, 180)
              : "Unknown acknowledgement error",
        });
      }
    }

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

    if (media.mimeType.toLowerCase() === "application/pdf") {
      try {
        if (!reservedTripId) {
          reservedTripId = await reserveTripDocument({
            senderPhone: message.senderPhone,
            messageId: persistedMessage.id,
          });
        }

        const parsed = await processPdfBytesForMessage(
          persistedMessage.id,
          media.bytes,
        );
        console.info("WhatsApp PDF parse summary", {
          status: parsed.status,
          itemCount: parsed.itemCount,
          skippedApproved: parsed.skippedApproved,
          tripCapture: Boolean(reservedTripId),
        });

        try {
          const automationResult = await runDocumentAutomationForDraft(
            parsed.draftId,
            { suppressReply: Boolean(reservedTripId) },
          );
          console.info("WhatsApp document automation summary", {
            result: automationResult,
            tripCapture: Boolean(reservedTripId),
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

        if (reservedTripId) {
          await markTripDocumentProcessed({
            messageId: persistedMessage.id,
            draftId: parsed.draftId,
            replyToMessageId: persistedMessage.id,
          });
        }
      } catch (error) {
        console.warn("WhatsApp PDF parsing did not complete", {
          messageStored: true,
          reason:
            error instanceof Error
              ? error.message.slice(0, 180)
              : "Unknown PDF error",
        });

        if (reservedTripId) {
          try {
            await markTripDocumentProcessed({
              messageId: persistedMessage.id,
              failed: true,
              errorCode: "pdf_processing_failed",
              replyToMessageId: persistedMessage.id,
            });
          } catch (tripError) {
            console.warn("Trip PDF failure status did not persist", {
              reason:
                tripError instanceof Error
                  ? tripError.message.slice(0, 180)
                  : "Unknown trip status error",
            });
          }
        }
      }
    } else if (message.type === "audio") {
      try {
        const transcript = await transcribeOperationalVoice({
          bytes: media.bytes,
          mimeType: media.mimeType,
        });

        if (!transcript) {
          throw new Error("Voice transcription was empty");
        }

        const { error: transcriptError } = await supabase
          .from("whatsapp_messages")
          .update({ text_body: transcript })
          .eq("id", persistedMessage.id);

        if (transcriptError) {
          throw new Error(
            "Failed to persist voice transcript: " + transcriptError.message,
          );
        }

        const voiceAsText: NormalizedWhatsAppMessage = {
          ...message,
          type: "text",
          textBody: transcript,
          media: undefined,
        };

        const voiceResult = await handleDocumentWorkflowInbound(
          voiceAsText,
          persistedMessage.id,
        );

        if (voiceResult === "ignored") {
          await sendOpsReply({
            requestId: deterministicUuid("voice-unsupported:" + message.messageId),
            replyToMessageId: persistedMessage.id,
            body:
              "🎙️ കേട്ടത്: " +
              transcript.slice(0, 220) +
              "\n\nഈ request ഇപ്പോൾ support ചെയ്യുന്ന command/query ആയി മനസ്സിലായില്ല. Hi എന്ന് അയച്ചാൽ options കാണാം.",
            knownInboundAt: message.timestamp,
          });
        }

        console.info("WhatsApp voice transcription completed", {
          handled: voiceResult === "handled",
          transcriptChars: transcript.length,
        });
      } catch (error) {
        console.warn("WhatsApp voice transcription did not complete", {
          reason:
            error instanceof Error
              ? error.message.slice(0, 180)
              : "Unknown voice error",
        });

        try {
          await sendOpsReply({
            requestId: deterministicUuid("voice-failed:" + message.messageId),
            replyToMessageId: persistedMessage.id,
            body:
              "🎙️ Voice message വ്യക്തമായി transcribe ചെയ്യാൻ കഴിഞ്ഞില്ല. വീണ്ടും ചെറിയ voice note ആയി അയക്കൂ, അല്ലെങ്കിൽ text ആയി അയക്കാം.",
            knownInboundAt: message.timestamp,
          });
        } catch {
          // The inbound media is still stored even when the error reply fails.
        }
      }
    } else {
      try {
        await sendUnsupportedMessageAck(message, persistedMessage.id);
      } catch (error) {
        console.warn("WhatsApp stored-media acknowledgement failed", {
          reason:
            error instanceof Error
              ? error.message.slice(0, 180)
              : "Unknown acknowledgement error",
        });
      }
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
