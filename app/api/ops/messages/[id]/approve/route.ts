import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { approveDocumentDraft } from "@/lib/document-processing";
import { processStockForDraft } from "@/lib/stock-workflow";
import {
  OPS_SESSION_COOKIE,
  isSameOriginRequest,
  verifyOpsSession,
} from "@/lib/ops-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  const dashboardUrl = new URL("/ops", request.url);

  try {
    const draftId = await approveDocumentDraft(id);
    const stock = await processStockForDraft({
      draftId,
      replyToMessageId: id,
      notifySuccess: true,
    });
    dashboardUrl.searchParams.set("document", "approved");
    dashboardUrl.searchParams.set("stock", stock.status);
    return NextResponse.redirect(dashboardUrl, 303);
  } catch (error) {
    console.error("Document approval failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    dashboardUrl.searchParams.set("document", "approval_failed");
    return NextResponse.redirect(dashboardUrl, 303);
  }
}
