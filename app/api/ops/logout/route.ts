import { NextResponse } from "next/server";
import {
  OPS_SESSION_COOKIE,
  isSameOriginRequest,
  opsSessionCookieOptions,
} from "@/lib/ops-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return Response.json({ error: "Invalid origin" }, { status: 403 });
  }

  const response = NextResponse.redirect(
    new URL("/ops/login", request.url),
    303,
  );

  response.cookies.set(OPS_SESSION_COOKIE, "", {
    ...opsSessionCookieOptions(),
    maxAge: 0,
  });
  response.headers.set("Cache-Control", "no-store");

  return response;
}
