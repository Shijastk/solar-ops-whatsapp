import { z } from "zod";
import {
  mobileUnauthorizedResponse,
  verifyMobileRequest,
} from "@/lib/mobile-api";
import { createOpeningStock } from "@/lib/stock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
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
    const result = await createOpeningStock(parsed.data);
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
