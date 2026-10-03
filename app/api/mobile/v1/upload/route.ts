import { createHash, randomUUID } from "node:crypto";
import { getIngestionEnv } from "@/lib/env";
import { processPdfBytesForMessage } from "@/lib/document-processing";
import { runDocumentAutomationForDraft } from "@/lib/document-automation";
import {
  mobileUnauthorizedResponse,
  verifyMobileRequest,
} from "@/lib/mobile-api";
import { attachMobileBill } from "@/lib/mobile-trips";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST(request: Request) {
  if (!verifyMobileRequest(request)) return mobileUnauthorizedResponse();
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const tripId = form?.get("tripId");
  if (
    !(file instanceof File) ||
    !file.name.toLowerCase().endsWith(".pdf") ||
    file.size < 5 ||
    file.size > 4 * 1024 * 1024
  )
    return Response.json(
      { error: "Choose a PDF smaller than 4 MB" },
      { status: 400 },
    );
  const bytes = Buffer.from(await file.arrayBuffer());
  if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-")))
    return Response.json({ error: "This file is not a PDF" }, { status: 400 });
  const db = getSupabaseAdmin();
  const id = randomUUID();
  const path = "mobile/" + id + "/bill.pdf";
  const bucket = getIngestionEnv().SUPABASE_STORAGE_BUCKET;
  let saved = false;
  try {
    const { error: storageError } = await db.storage
      .from(bucket)
      .upload(path, bytes, { contentType: "application/pdf" });
    if (storageError) throw new Error("Could not save PDF");
    const { error } = await db
      .from("whatsapp_messages")
      .insert({
        id,
        whatsapp_message_id: "mobile:" + id,
        sender_phone: "mobile-operator",
        sender_name: "Mobile",
        message_type: "document",
        original_filename: file.name.slice(0, 120),
        mime_type: "application/pdf",
        media_size_bytes: file.size,
        media_sha256: createHash("sha256").update(bytes).digest("hex"),
        storage_path: path,
        received_at: new Date().toISOString(),
        processed_at: new Date().toISOString(),
        processing_status: "stored",
      });
    if (error) {
      await db.storage.from(bucket).remove([path]);
      throw new Error("Could not save bill");
    }
    saved = true;
    const parsed = await processPdfBytesForMessage(id, bytes);
    if (!parsed.duplicate)
      await runDocumentAutomationForDraft(parsed.draftId, {
        suppressReply: true,
      });
    const { data: draft, error: draftError } = await db
      .from("document_drafts")
      .select("stock_status")
      .eq("id", parsed.draftId)
      .single();
    if (draftError) throw new Error("Bill saved. Refresh to check it.");
    const duplicate =
      parsed.duplicate || draft.stock_status === "duplicate_document";
    if (typeof tripId === "string" && tripId && !duplicate)
      await attachMobileBill(tripId, id);
    return Response.json(
      { id, duplicate, message: duplicate ? "Already uploaded" : "Bill saved" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    console.error("Mobile upload failed", {
      reason: e instanceof Error ? e.message : "Unknown",
    });
    return Response.json(
      {
        error: saved
          ? "Bill saved. Refresh to check its processing or company before uploading again."
          : "Could not save bill. Try again.",
      },
      { status: 400 },
    );
  }
}
