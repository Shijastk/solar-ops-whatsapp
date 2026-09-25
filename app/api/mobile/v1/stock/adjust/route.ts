import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  mobileUnauthorizedResponse,
  verifyMobileRequest,
} from "@/lib/mobile-api";
import { adjustStockBalance } from "@/lib/stock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  productId: z.string().uuid(),
  targetQuantity: z.union([z.string(), z.number()]),
  actionKey: z.string().uuid().optional(),
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
    return Response.json({ error: "Invalid stock adjustment" }, { status: 400 });
  }

  try {
    const result = await adjustStockBalance({
      productId: parsed.data.productId,
      targetQuantity: parsed.data.targetQuantity,
      actionKey: parsed.data.actionKey ?? randomUUID(),
    });
    return Response.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Mobile stock adjustment failed", {
      message:
        error instanceof Error ? error.message.slice(0, 300) : "Unknown error",
    });
    return Response.json(
      { error: "Unable to adjust stock" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
