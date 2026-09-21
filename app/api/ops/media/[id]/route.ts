import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getIngestionEnv } from "@/lib/env";
import {
  OPS_SESSION_COOKIE,
  verifyOpsSession,
} from "@/lib/ops-auth";
import { getOpsMessageById } from "@/lib/ops-data";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const cookieStore = await cookies();
  if (!verifyOpsSession(cookieStore.get(OPS_SESSION_COOKIE)?.value)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
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
    console.error("Ops signed file URL failed", {
      messageIdPresent: true,
      hasStoragePath: true,
    });
    return Response.json(
      { error: "Unable to open file" },
      { status: 502 },
    );
  }

  const response = NextResponse.redirect(data.signedUrl, 302);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
