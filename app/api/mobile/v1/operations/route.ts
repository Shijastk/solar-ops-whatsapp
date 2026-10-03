import { z } from "zod";
import {
  mobileUnauthorizedResponse,
  verifyMobileRequest,
} from "@/lib/mobile-api";
import {
  attachMobileBill,
  createMobileTrip,
  saveMobileDriver,
  updateMobileTrip,
} from "@/lib/mobile-trips";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create_trip"),
    companyId: z.uuid().nullable().optional(),
  }),
  z.object({
    action: z.literal("driver"),
    name: z.string().trim().min(1).max(120),
  }),
  z.object({
    action: z.literal("attach_bill"),
    tripId: z.uuid(),
    messageId: z.uuid(),
  }),
  z.object({
    action: z.literal("update_trip"),
    tripId: z.uuid(),
    driverId: z.uuid().nullable(),
    close: z.boolean(),
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
  try {
    const b = parsed.data;
    if (b.action === "create_trip")
      return Response.json(await createMobileTrip(b.companyId ?? null));
    if (b.action === "driver")
      return Response.json(await saveMobileDriver(b.name));
    if (b.action === "attach_bill")
      await attachMobileBill(b.tripId, b.messageId);
    if (b.action === "update_trip")
      await updateMobileTrip(b.tripId, b.driverId, b.close);
    return Response.json(
      { status: "saved" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Could not save" },
      { status: 409 },
    );
  }
}
