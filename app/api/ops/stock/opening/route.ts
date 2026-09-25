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

function wantsJson(request: Request): boolean {
  return request.headers.get("accept")?.includes("application/json") ?? false;
}

export function openingStockErrorState(message: string): string {
  if (message.includes("GSTIN is required")) return "gstin_required";
  if (message.includes("GSTIN")) return "invalid_gstin";
  if (message.includes("existing company")) return "company_required";
  if (message.includes("Product name")) return "product_required";
  if (message.includes("Unit")) return "invalid_unit";
  if (message.includes("HSN")) return "invalid_hsn";
  return "failed";
}

function resultResponse(
  request: Request,
  target: URL,
  status: string,
  httpStatus = 200,
) {
  if (wantsJson(request)) {
    return Response.json({ status }, { status: httpStatus });
  }

  target.searchParams.set("result", status);
  return NextResponse.redirect(target, 303);
}

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

    return resultResponse(request, target, result.status);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown opening stock error";
    const status = openingStockErrorState(message);

    console.error("Opening stock setup failed", { message });
    return resultResponse(request, target, status, 400);
  }
}
