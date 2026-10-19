import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  OPS_SESSION_COOKIE,
  isSameOriginRequest,
  verifyOpsSession,
} from "@/lib/ops-auth";
import { setAgentEnabled } from "@/lib/agent-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const dashboardUrl = new URL("/ops/settings", request.url);

  if (!isSameOriginRequest(request)) {
    return Response.json({ error: "Invalid origin" }, { status: 403 });
  }

  const cookieStore = await cookies();
  if (!verifyOpsSession(cookieStore.get(OPS_SESSION_COOKIE)?.value)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const form = await request.formData();
  const value = form.get("enabled");
  if (value !== "true" && value !== "false") {
    dashboardUrl.searchParams.set("result", "invalid");
    return NextResponse.redirect(dashboardUrl, 303);
  }

  try {
    await setAgentEnabled(value === "true");
    dashboardUrl.searchParams.set("result", value === "true" ? "enabled" : "disabled");
  } catch {
    dashboardUrl.searchParams.set("result", "failed");
  }

  return NextResponse.redirect(dashboardUrl, 303);
}
