import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getIngestionEnv } from "@/lib/env";
import {
  OPS_SESSION_COOKIE,
  isSameOriginRequest,
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

  const message = await getOpsMessageById(id);
  const dashboardUrl = new URL("/ops", request.url);

  if (!message?.storage_path) {
    dashboardUrl.searchParams.set("file", "unavailable");
    return NextResponse.redirect(dashboardUrl, 303);
  }

  if (message.processing_status !== "stored") {
    return Response.json(
      { error: "Only successfully stored media can be deleted" },
      { status: 409 },
    );
  }

  const env = getIngestionEnv();
  const supabase = getSupabaseAdmin();
  const storagePath = message.storage_path;

  const { error: removeError } = await supabase.storage
    .from(env.SUPABASE_STORAGE_BUCKET)
    .remove([storagePath]);

  if (removeError) {
    console.error("Ops media deletion failed", {
      messageIdPresent: true,
      hasStoragePath: true,
    });
    return Response.json(
      { error: "Unable to delete file" },
      { status: 502 },
    );
  }

  const { error: updateError } = await supabase
    .from("whatsapp_messages")
    .update({ storage_path: null })
    .eq("id", id)
    .eq("storage_path", storagePath);

  if (updateError) {
    console.error("Ops media deletion finalization failed", {
      messageIdPresent: true,
    });
    return Response.json(
      { error: "File deleted but database finalization failed" },
      { status: 500 },
    );
  }

  dashboardUrl.searchParams.set("file", "deleted");
  return NextResponse.redirect(dashboardUrl, 303);
}
