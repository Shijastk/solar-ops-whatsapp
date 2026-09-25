import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  OPS_SESSION_COOKIE,
  isSameOriginRequest,
  verifyOpsSession,
} from "@/lib/ops-auth";
import { sendOpsReply } from "@/lib/replies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function replyRedirectState(
  status: string,
): "sent" | "pending" | "failed" {
  if (status === "failed") return "failed";
  if (status === "queued") return "pending";
  return "sent";
}

const replySchema = z.object({
  requestId: z.string().uuid(),
  body: z.string().trim().min(1).max(2000),
});

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!isSameOriginRequest(request)) {
    return Response.json({ error: "Invalid origin" }, { status: 403 });
  }

  const cookieStore = await cookies();
  if (!verifyOpsSession(cookieStore.get(OPS_SESSION_COOKIE)?.value)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  if (!isUuid(id)) {
    return Response.json({ error: "Invalid message id" }, { status: 400 });
  }

  const formData = await request.formData();
  const parsed = replySchema.safeParse({
    requestId: formData.get("requestId"),
    body: formData.get("body"),
  });

  const dashboardUrl = new URL("/ops", request.url);
  if (!parsed.success) {
    dashboardUrl.searchParams.set("reply", "invalid");
    return NextResponse.redirect(dashboardUrl, 303);
  }

  try {
    const result = await sendOpsReply({
      requestId: parsed.data.requestId,
      replyToMessageId: id,
      body: parsed.data.body,
    });

    dashboardUrl.searchParams.set("reply", replyRedirectState(result.status));
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    console.error("Manual WhatsApp reply failed", {
      message: message.slice(0, 500),
    });
    dashboardUrl.searchParams.set(
      "reply",
      message.includes("24-hour") ? "window_closed" : "failed",
    );
  }

  return NextResponse.redirect(dashboardUrl, 303);
}
