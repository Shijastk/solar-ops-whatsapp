import { z } from "zod";
import {
  mobileUnauthorizedResponse,
  verifyMobileRequest,
} from "@/lib/mobile-api";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
export const runtime = "nodejs";
const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("cancel"),
    draftId: z.uuid(),
    requestId: z.uuid(),
  }),
  z.object({
    action: z.literal("quantity"),
    draftId: z.uuid(),
    itemId: z.uuid(),
    quantity: z.number().positive().finite(),
    requestId: z.uuid(),
  }),
  z.object({
    action: z.literal("vehicle"),
    draftId: z.uuid(),
    value: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9 -]{4,20}$/),
    requestId: z.uuid(),
  }),
  z.object({
    action: z.literal("number"),
    draftId: z.uuid(),
    value: z.string().trim().min(1).max(120),
    requestId: z.uuid(),
  }),
]);
export async function POST(request: Request) {
  if (!verifyMobileRequest(request)) return mobileUnauthorizedResponse();
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json(
      { error: "Check the entered details" },
      { status: 400 },
    );
  const b = parsed.data;
  const { data, error } = await getSupabaseAdmin().rpc("mobile_bill_change", {
    p_draft_id: b.draftId,
    p_action: b.action,
    p_item_id: b.action === "quantity" ? b.itemId : null,
    p_quantity: b.action === "quantity" ? b.quantity : null,
    p_value: b.action === "vehicle" || b.action === "number" ? b.value : null,
    p_request_id: b.requestId,
  });
  if (error) return Response.json({ error: error.message }, { status: 409 });
  return Response.json(data, { headers: { "Cache-Control": "no-store" } });
}
