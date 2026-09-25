import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  OPS_SESSION_COOKIE,
  isSameOriginRequest,
  verifyOpsSession,
} from "@/lib/ops-auth";
import { createOpeningStock } from "@/lib/stock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return Response.json({ error: "Invalid origin" }, { status: 403 });
  }

  const cookieStore = await cookies();
  if (!verifyOpsSession(cookieStore.get(OPS_SESSION_COOKIE)?.value)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const target = new URL("/ops/stock", request.url);

  try {
    const form = await request.formData();
    const result = await createOpeningStock({
      companyId: String(form.get("companyId") ?? ""),
      companyName: String(form.get("companyName") ?? ""),
      companyGstin: String(form.get("companyGstin") ?? ""),
      productName: String(form.get("productName") ?? ""),
      unit: String(form.get("unit") ?? ""),
      hsnSac: String(form.get("hsnSac") ?? ""),
      quantity: String(form.get("quantity") ?? ""),
    });

    target.searchParams.set("result", result.status);
  } catch (error) {
    console.error("Opening stock setup failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    target.searchParams.set("result", "failed");
  }

  return NextResponse.redirect(target, 303);
}
