import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  isUuid,
  mobileUnauthorizedResponse,
  verifyMobileRequest,
} from "@/lib/mobile-api";
import { sendOpsReply } from "@/lib/replies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  body: z.string().trim().min(1).max(2000),
  requestId: z.string().uuid().optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!verifyMobileRequest(request)) {
    return mobileUnauthorizedResponse();
  }

  const { id } = await context.params;
  if (!isUuid(id)) {
    return Response.json({ error: "Invalid message id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid reply" }, { status: 400 });
  }

  try {
    const result = await sendOpsReply({
      requestId: parsed.data.requestId ?? randomUUID(),
      replyToMessageId: id,
      body: parsed.data.body,
    });

    return Response.json(
      {
        status: result.status,
        duplicate: result.duplicate,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const windowClosed = message.includes("24-hour");

    console.error("Mobile WhatsApp reply failed", {
      message: message.slice(0, 500),
    });

    return Response.json(
      {
        error: windowClosed
          ? "24-hour customer service window is closed"
          : "Unable to send reply",
        code: windowClosed ? "window_closed" : "send_failed",
      },
      {
        status: windowClosed ? 409 : 400,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
