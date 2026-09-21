import { ZodError } from "zod";
import { getWebhookEnv } from "@/lib/env";
import { ingestWhatsAppMessage } from "@/lib/ingest";
import { applyWhatsAppStatusUpdates } from "@/lib/replies";
import { verifyMetaSignature } from "@/lib/signature";
import {
  extractWhatsAppMessages,
  extractWhatsAppStatuses,
} from "@/lib/whatsapp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const env = getWebhookEnv();
    const url = new URL(request.url);

    const mode = url.searchParams.get("hub.mode");
    const verifyToken = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (
      mode === "subscribe" &&
      challenge &&
      verifyToken === env.WHATSAPP_VERIFY_TOKEN
    ) {
      return new Response(challenge, {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    }

    return Response.json({ error: "Verification failed" }, { status: 403 });
  } catch (error) {
    if (error instanceof ZodError) {
      return Response.json(
        { error: "Webhook is not configured" },
        { status: 503 },
      );
    }

    console.error("WhatsApp verification error", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const rawBody = await request.text();

  try {
    const env = getWebhookEnv();
    const signature = request.headers.get("x-hub-signature-256");

    if (!verifyMetaSignature(rawBody, signature, env.META_APP_SECRET)) {
      return Response.json({ error: "Invalid signature" }, { status: 401 });
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const messages = extractWhatsAppMessages(payload);
    const statuses = extractWhatsAppStatuses(payload);
    const statusUpdates = await applyWhatsAppStatusUpdates(statuses);

    if (messages.length === 0) {
      console.info("WhatsApp webhook received no parseable messages", {
        messageCount: 0,
        statusCount: statuses.length,
        statusUpdates,
      });
      return Response.json({
        received: true,
        processed: 0,
        statusUpdates,
      });
    }

    const results = [];
    for (const message of messages) {
      const result = await ingestWhatsAppMessage(message);
      results.push({
        messageId: message.messageId,
        result,
      });
    }

    console.info("WhatsApp webhook processing summary", {
      messageCount: messages.length,
      messageTypes: messages.map((message) => message.type),
      storedCount: results.filter((item) => item.result === "stored").length,
      ignoredCount: results.filter((item) => item.result === "ignored").length,
      statusCount: statuses.length,
      statusUpdates,
    });

    return Response.json({
      received: true,
      processed: results.length,
      statusUpdates,
      results,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      const invalidFields = Array.from(
        new Set(
          error.issues
            .map((issue) => issue.path[0])
            .filter((field): field is string => typeof field === "string"),
        ),
      ).sort();

      console.error("WhatsApp environment configuration is invalid", {
        invalidFields,
      });
      return Response.json(
        {
          error: "Webhook is not fully configured",
          invalidFields,
        },
        { status: 503 },
      );
    }

    console.error("WhatsApp webhook processing failed", error);
    return Response.json(
      { error: "Webhook processing failed" },
      { status: 500 },
    );
  }
}
