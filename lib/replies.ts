import {
  sendWhatsAppList,
  sendWhatsAppReplyButtons,
  sendWhatsAppTextReply,
  type WhatsAppListRow,
  type WhatsAppReplyButton,
} from "@/lib/meta-messages";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type { NormalizedWhatsAppStatus } from "@/lib/whatsapp";

const CUSTOMER_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_REPLY_CHARS = 2000;

type SendResult = {
  status: string;
  metaMessageId: string | null;
  duplicate: boolean;
};

type PersistedSendInput = {
  requestId: string;
  replyToMessageId: string;
  body: string;
  messageKind: "text" | "interactive";
  send: (target: {
    recipientPhone: string;
    whatsappMessageId: string;
  }) => Promise<string>;
};

export function isWithinCustomerServiceWindow(
  lastInboundAt: string | Date,
  now = new Date(),
): boolean {
  const inbound = new Date(lastInboundAt);
  const age = now.getTime() - inbound.getTime();

  return (
    Number.isFinite(inbound.getTime()) &&
    age >= -5 * 60 * 1000 &&
    age <= CUSTOMER_SERVICE_WINDOW_MS
  );
}

async function sendPersistedReply(input: PersistedSendInput): Promise<SendResult> {
  const body = input.body.trim();
  if (!body) {
    throw new Error("Reply text is required");
  }
  if (body.length > MAX_REPLY_CHARS) {
    throw new Error("Reply text is too long");
  }

  const supabase = getSupabaseAdmin();

  const { data: duplicate, error: duplicateError } = await supabase
    .from("whatsapp_outbound_messages")
    .select("status, meta_message_id")
    .eq("request_id", input.requestId)
    .maybeSingle();

  if (duplicateError) {
    throw new Error(
      "Failed to check reply idempotency: " + duplicateError.message,
    );
  }
  if (duplicate) {
    return {
      status: duplicate.status,
      metaMessageId: duplicate.meta_message_id,
      duplicate: true,
    };
  }

  const { data: target, error: targetError } = await supabase
    .from("whatsapp_messages")
    .select("id, whatsapp_message_id, sender_phone")
    .eq("id", input.replyToMessageId)
    .maybeSingle();

  if (targetError) {
    throw new Error("Failed to load reply target: " + targetError.message);
  }
  if (!target) {
    throw new Error("Reply target was not found");
  }

  const { data: latestInbound, error: latestError } = await supabase
    .from("whatsapp_messages")
    .select("received_at")
    .eq("sender_phone", target.sender_phone)
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestError) {
    throw new Error(
      "Failed to inspect WhatsApp service window: " + latestError.message,
    );
  }
  if (
    !latestInbound ||
    !isWithinCustomerServiceWindow(latestInbound.received_at)
  ) {
    throw new Error(
      "The 24-hour WhatsApp customer service window is closed",
    );
  }

  const { error: queueError } = await supabase
    .from("whatsapp_outbound_messages")
    .insert({
      request_id: input.requestId,
      reply_to_message_id: target.id,
      recipient_phone: target.sender_phone,
      body,
      message_kind: input.messageKind,
      status: "queued",
    });

  if (queueError) {
    if (queueError.code === "23505") {
      const { data } = await supabase
        .from("whatsapp_outbound_messages")
        .select("status, meta_message_id")
        .eq("request_id", input.requestId)
        .maybeSingle();

      if (data) {
        return {
          status: data.status,
          metaMessageId: data.meta_message_id,
          duplicate: true,
        };
      }
    }
    throw new Error("Failed to queue WhatsApp reply: " + queueError.message);
  }

  try {
    const metaMessageId = await input.send({
      recipientPhone: target.sender_phone,
      whatsappMessageId: target.whatsapp_message_id,
    });
    const now = new Date().toISOString();

    const { error: updateError } = await supabase
      .from("whatsapp_outbound_messages")
      .update({
        meta_message_id: metaMessageId,
        status: "sent",
        sent_at: now,
        status_updated_at: now,
        error_message: null,
      })
      .eq("request_id", input.requestId);

    if (updateError) {
      throw new Error(
        "WhatsApp reply was sent but persistence failed: " +
          updateError.message,
      );
    }

    return { status: "sent", metaMessageId, duplicate: false };
  } catch (error) {
    const message =
      error instanceof Error ? error.message.slice(0, 1000) : "Reply failed";

    await supabase
      .from("whatsapp_outbound_messages")
      .update({
        status: "failed",
        status_updated_at: new Date().toISOString(),
        error_message: message,
      })
      .eq("request_id", input.requestId);

    throw error;
  }
}

export async function sendOpsReply(input: {
  requestId: string;
  replyToMessageId: string;
  body: string;
}): Promise<SendResult> {
  return sendPersistedReply({
    ...input,
    messageKind: "text",
    send: ({ recipientPhone, whatsappMessageId }) =>
      sendWhatsAppTextReply({
        recipientPhone,
        replyToMessageId: whatsappMessageId,
        body: input.body,
      }),
  });
}

export async function sendOpsReplyButtons(input: {
  requestId: string;
  replyToMessageId: string;
  body: string;
  buttons: WhatsAppReplyButton[];
}): Promise<SendResult> {
  return sendPersistedReply({
    requestId: input.requestId,
    replyToMessageId: input.replyToMessageId,
    body: input.body,
    messageKind: "interactive",
    send: ({ recipientPhone, whatsappMessageId }) =>
      sendWhatsAppReplyButtons({
        recipientPhone,
        replyToMessageId: whatsappMessageId,
        body: input.body,
        buttons: input.buttons,
      }),
  });
}

export async function sendOpsList(input: {
  requestId: string;
  replyToMessageId: string;
  body: string;
  buttonText: string;
  rows: WhatsAppListRow[];
}): Promise<SendResult> {
  return sendPersistedReply({
    requestId: input.requestId,
    replyToMessageId: input.replyToMessageId,
    body: input.body,
    messageKind: "interactive",
    send: ({ recipientPhone, whatsappMessageId }) =>
      sendWhatsAppList({
        recipientPhone,
        replyToMessageId: whatsappMessageId,
        body: input.body,
        buttonText: input.buttonText,
        rows: input.rows,
      }),
  });
}

export async function applyWhatsAppStatusUpdates(
  statuses: NormalizedWhatsAppStatus[],
): Promise<number> {
  const supabase = getSupabaseAdmin();
  let updated = 0;

  for (const status of statuses) {
    const { data: current, error: readError } = await supabase
      .from("whatsapp_outbound_messages")
      .select("id, status_updated_at")
      .eq("meta_message_id", status.messageId)
      .maybeSingle();

    if (readError) {
      throw new Error("Failed to load outbound status: " + readError.message);
    }
    if (!current) {
      continue;
    }

    const incomingAt = status.timestamp.toISOString();
    if (
      current.status_updated_at &&
      new Date(current.status_updated_at).getTime() >
        status.timestamp.getTime()
    ) {
      continue;
    }

    const errorMessage =
      status.status === "failed"
        ? [
            status.errorCode ? "Meta code " + status.errorCode : null,
            status.errorTitle ?? null,
          ]
            .filter(Boolean)
            .join(": ")
            .slice(0, 1000) || "WhatsApp delivery failed"
        : null;

    const { error: updateError } = await supabase
      .from("whatsapp_outbound_messages")
      .update({
        status: status.status,
        status_updated_at: incomingAt,
        error_message: errorMessage,
      })
      .eq("id", current.id);

    if (updateError) {
      throw new Error(
        "Failed to update outbound status: " + updateError.message,
      );
    }
    updated += 1;
  }

  return updated;
}
