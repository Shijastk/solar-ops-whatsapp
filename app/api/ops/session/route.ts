import { NextResponse } from "next/server";
import {
  OPS_SESSION_COOKIE,
  createOpsSession,
  isSameOriginRequest,
  isValidOpsAccessKey,
  opsSessionCookieOptions,
} from "@/lib/ops-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return Response.json({ error: "Invalid origin" }, { status: 403 });
  }

  const formData = await request.formData();
  const accessKey = formData.get("accessKey");
  const loginUrl = new URL("/ops/login", request.url);

  if (typeof accessKey !== "string" || !isValidOpsAccessKey(accessKey)) {
    loginUrl.searchParams.set("error", "1");
    return NextResponse.redirect(loginUrl, 303);
  }

  const response = NextResponse.redirect(new URL("/ops", request.url), 303);
  response.cookies.set(
    OPS_SESSION_COOKIE,
    createOpsSession(),
    opsSessionCookieOptions(),
  );
  response.headers.set("Cache-Control", "no-store");

  return response;
}
