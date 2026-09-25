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
      allowSimilarCompany: form.get("allowSimilarCompany") === "on",
      allowSimilarProduct: form.get("allowSimilarProduct") === "on",
    });

    target.searchParams.set("result", result.status);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown opening stock error";

    console.error("Opening stock setup failed", { message });

    if (message.includes("GSTIN")) {
      target.searchParams.set("result", "invalid_gstin");
    } else if (message.includes("existing company")) {
      target.searchParams.set("result", "company_required");
    } else if (message.includes("Product name")) {
      target.searchParams.set("result", "product_required");
    } else if (message.includes("Unit")) {
      target.searchParams.set("result", "invalid_unit");
    } else if (message.includes("HSN")) {
      target.searchParams.set("result", "invalid_hsn");
    } else {
      target.searchParams.set("result", "failed");
    }
  }

  return NextResponse.redirect(target, 303);
}
