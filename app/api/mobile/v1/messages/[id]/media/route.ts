import { getIngestionEnv } from "@/lib/env";
import { getOpsMessageById } from "@/lib/ops-data";
import {
  isUuid,
  mobileUnauthorizedResponse,
  verifyMobileRequest,
} from "@/lib/mobile-api";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
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

  const message = await getOpsMessageById(id);
  if (!message?.storage_path) {
    return Response.json({ error: "File is not available" }, { status: 404 });
  }

  const env = getIngestionEnv();
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.storage
    .from(env.SUPABASE_STORAGE_BUCKET)
    .createSignedUrl(message.storage_path, 5 * 60);

  if (error || !data?.signedUrl) {
    console.error("Mobile signed file URL failed", {
      messageIdPresent: true,
      hasStoragePath: true,
    });
    return Response.json(
      { error: "Unable to open file" },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }

  return Response.json(
    { url: data.signedUrl, expiresInSeconds: 300 },
    { headers: { "Cache-Control": "no-store" } },
  );
}
