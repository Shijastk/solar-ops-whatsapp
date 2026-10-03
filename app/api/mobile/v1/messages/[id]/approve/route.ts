import { approveDocumentDraft } from "@/lib/document-processing";
import {
  isUuid,
  mobileUnauthorizedResponse,
  verifyMobileRequest,
} from "@/lib/mobile-api";
import { processStockForDraft } from "@/lib/stock-workflow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  try {
    const draftId = await approveDocumentDraft(id);
    const stock = await processStockForDraft({
      draftId,
      replyToMessageId: id,
      suppressNotifications: true,
    });

    return Response.json(
      { status: "approved", stockStatus: stock.status },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Mobile document approval failed", {
      message:
        error instanceof Error ? error.message.slice(0, 300) : "Unknown error",
    });
    return Response.json(
      { error: "Document approval failed" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}

