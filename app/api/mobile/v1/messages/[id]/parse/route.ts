import { runDocumentAutomationForDraft } from "@/lib/document-automation";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { processStoredPdfMessage } from "@/lib/document-processing";
import {
  isUuid,
  mobileUnauthorizedResponse,
  verifyMobileRequest,
} from "@/lib/mobile-api";

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
    const { data: existing, error: readError } = await getSupabaseAdmin()
      .from("document_drafts")
      .select("id,parse_status,workflow_status")
      .eq("message_id", id)
      .maybeSingle();
    if (readError) throw new Error("Could not load bill");
    const result =
      existing?.parse_status === "approved"
        ? { draftId: existing.id, status: existing.parse_status }
        : await processStoredPdfMessage(id);
    await runDocumentAutomationForDraft(result.draftId, {
      suppressReply: true,
    });
    return Response.json(
      { status: result.status },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Mobile document parsing failed", {
      message:
        error instanceof Error ? error.message.slice(0, 300) : "Unknown error",
    });
    return Response.json(
      { error: "Document parsing failed" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
