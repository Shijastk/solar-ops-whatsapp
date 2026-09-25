import { z } from "zod";
import { getIngestionEnv } from "@/lib/env";

const sendResponseSchema = z.object({
  messages: z
    .array(
      z.object({
        id: z.string().min(1),
      }),
    )
    .min(1),
});

const errorResponseSchema = z.object({
  error: z.object({
    message: z.string().optional(),
    type: z.string().optional(),
    code: z.number().int().optional(),
    error_subcode: z.number().int().optional(),
  }),
});

function redactProviderErrorText(value: string): string {
  return value
    .replace(/wamid\.[A-Za-z0-9_.:-]+/gi, "[redacted-message-id]")
    .replace(/\+?\d[\d\s().-]{6,}\d/g, "[redacted-number]")
    .replace(/[A-Za-z0-9_-]{32,}/g, "[redacted-id]")
    .slice(0, 320);
}

async function readMetaErrorSummary(response: Response): Promise<string> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return "";
  }

  const parsed = errorResponseSchema.safeParse(payload);
  if (!parsed.success) return "";

  const parts = [
    parsed.data.error.code !== undefined
      ? "Meta code " + parsed.data.error.code
      : null,
    parsed.data.error.error_subcode !== undefined
      ? "subcode " + parsed.data.error.error_subcode
      : null,
    parsed.data.error.type
      ? "type " + redactProviderErrorText(parsed.data.error.type)
      : null,
    parsed.data.error.message
      ? redactProviderErrorText(parsed.data.error.message)
      : null,
  ].filter((part): part is string => Boolean(part));

  return parts.join("; ");
}

export async function sendWhatsAppTextReply(input: {
  recipientPhone: string;
  replyToMessageId: string;
  body: string;
}): Promise<string> {
  const env = getIngestionEnv();

  if (!env.WHATSAPP_PHONE_NUMBER_ID) {
    throw new Error("WhatsApp Phone Number ID is not configured");
  }

  const response = await fetch(
    "https://graph.facebook.com/" +
      env.META_GRAPH_API_VERSION +
      "/" +
      encodeURIComponent(env.WHATSAPP_PHONE_NUMBER_ID) +
      "/messages",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + env.WHATSAPP_ACCESS_TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: input.recipientPhone,
        context: {
          message_id: input.replyToMessageId,
        },
        type: "text",
        text: {
          preview_url: false,
          body: input.body,
        },
      }),
      cache: "no-store",
    },
  );

  if (!response.ok) {
    const providerSummary = await readMetaErrorSummary(response);
    throw new Error(
      "WhatsApp reply request failed with HTTP " +
        response.status +
        (providerSummary ? "; " + providerSummary : ""),
    );
  }

  const parsed = sendResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error("WhatsApp reply response was invalid");
  }

  return parsed.data.messages[0].id;
}
