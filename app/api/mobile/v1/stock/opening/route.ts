import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  mobileUnauthorizedResponse,
  verifyMobileRequest,
} from "@/lib/mobile-api";
import { createOpeningStock, recordStockIn } from "@/lib/stock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  productId: z.uuid().nullable().optional(),
  requestId: z.uuid().optional(),
  companyId: z.string().nullable().optional(),
  companyName: z.string().nullable().optional(),
  companyGstin: z.string().nullable().optional(),
  productName: z.string(),
  unit: z.string(),
  hsnSac: z.string().nullable().optional(),
  quantity: z.union([z.string(), z.number()]),
  allowSimilarCompany: z.boolean().optional(),
  allowSimilarProduct: z.boolean().optional(),
});

export async function POST(request: Request) {
  if (!verifyMobileRequest(request)) {
    return mobileUnauthorizedResponse();
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid stock input" }, { status: 400 });
  }

  try {
    if (parsed.data.productId) {
      const { data: product, error } = await getSupabaseAdmin()
        .from("stock_products")
        .select("company_id")
        .eq("id", parsed.data.productId)
        .eq("active", true)
        .single();
      if (
        error ||
        !product ||
        (parsed.data.companyId && product.company_id !== parsed.data.companyId)
      )
        return Response.json(
          { error: "Choose a product from this company" },
          { status: 409 },
        );
    }
    const result = parsed.data.productId
      ? await recordStockIn({
          productId: parsed.data.productId,
          quantity: parsed.data.quantity,
          actionKey: parsed.data.requestId ?? randomUUID(),
        })
      : await createOpeningStock({
          ...parsed.data,
          actionKey: parsed.data.requestId ?? randomUUID(),
        });
    if (
      [
        "potential_company_duplicate",
        "potential_product_duplicate",
        "not_ready",
        "inconsistent",
      ].includes(result.status)
    )
      return Response.json(
        {
          error:
            result.status === "potential_product_duplicate"
              ? "A similar product exists. Choose it or confirm a different product."
              : "Check the company and product before saving.",
          code: result.status,
        },
        { status: 409 },
      );
    return Response.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown opening stock error";
    console.error("Mobile opening stock failed", {
      message: message.slice(0, 300),
    });
    return Response.json(
      { error: message },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
