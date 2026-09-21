import { z } from "zod";

const mediaSchema = z
  .object({
    id: z.string().min(1),
    mime_type: z.string().optional(),
    sha256: z.string().optional(),
    filename: z.string().optional(),
    voice: z.boolean().optional(),
  })
  .passthrough();

const messageSchema = z
  .object({
    from: z.string().min(1),
    id: z.string().min(1),
    timestamp: z.string().min(1),
    type: z.string().min(1),
    text: z.object({ body: z.string() }).optional(),
    document: mediaSchema.optional(),
    image: mediaSchema.optional(),
    audio: mediaSchema.optional(),
    video: mediaSchema.optional(),
    sticker: mediaSchema.optional(),
  })
  .passthrough();

const changeSchema = z
  .object({
    field: z.string(),
    value: z
      .object({
        messaging_product: z.string().optional(),
        metadata: z
          .object({
            display_phone_number: z.string().optional(),
            phone_number_id: z.string().optional(),
          })
          .optional(),
        contacts: z
          .array(
            z
              .object({
                wa_id: z.string().optional(),
                profile: z.object({ name: z.string().optional() }).optional(),
              })
              .passthrough(),
          )
          .optional(),
        messages: z.array(messageSchema).optional(),
      })
      .passthrough(),
  })
  .passthrough();

const webhookSchema = z
  .object({
    object: z.string(),
    entry: z.array(
      z
        .object({
          id: z.string().optional(),
          changes: z.array(changeSchema),
        })
        .passthrough(),
    ),
  })
  .passthrough();

export type NormalizedWhatsAppMessage = {
  wabaId?: string;
  phoneNumberId?: string;
  displayPhoneNumber?: string;
  senderPhone: string;
  senderName?: string;
  messageId: string;
  timestamp: Date;
  type: string;
  textBody?: string;
  media?: {
    id: string;
    mimeType?: string;
    sha256?: string;
    filename?: string;
    voice?: boolean;
  };
};

function mediaForMessage(message: z.infer<typeof messageSchema>) {
  const candidate =
    message.document ??
    message.image ??
    message.audio ??
    message.video ??
    message.sticker;

  if (!candidate) {
    return undefined;
  }

  return {
    id: candidate.id,
    mimeType: candidate.mime_type,
    sha256: candidate.sha256,
    filename: candidate.filename,
    voice: candidate.voice,
  };
}

export function extractWhatsAppMessages(
  payload: unknown,
): NormalizedWhatsAppMessage[] {
  const parsed = webhookSchema.safeParse(payload);
  if (!parsed.success || parsed.data.object !== "whatsapp_business_account") {
    return [];
  }

  const output: NormalizedWhatsAppMessage[] = [];

  for (const entry of parsed.data.entry) {
    for (const change of entry.changes) {
      if (change.field !== "messages" || !change.value.messages) {
        continue;
      }

      const contactById = new Map(
        (change.value.contacts ?? [])
          .filter((contact) => contact.wa_id)
          .map((contact) => [contact.wa_id as string, contact]),
      );

      for (const message of change.value.messages) {
        const seconds = Number(message.timestamp);
        if (!Number.isFinite(seconds)) {
          continue;
        }

        const contact = contactById.get(message.from);

        output.push({
          wabaId: entry.id,
          phoneNumberId: change.value.metadata?.phone_number_id,
          displayPhoneNumber: change.value.metadata?.display_phone_number,
          senderPhone: message.from,
          senderName: contact?.profile?.name,
          messageId: message.id,
          timestamp: new Date(seconds * 1000),
          type: message.type,
          textBody: message.text?.body,
          media: mediaForMessage(message),
        });
      }
    }
  }

  return output;
}
