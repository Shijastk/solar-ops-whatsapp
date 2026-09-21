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
    throw new Error("WhatsApp reply request failed with HTTP " + response.status);
  }

  const parsed = sendResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error("WhatsApp reply response was invalid");
  }

  return parsed.data.messages[0].id;
}
