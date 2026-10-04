import { z } from "zod";
import {
  mobileUnauthorizedResponse,
  verifyMobileRequest,
} from "@/lib/mobile-api";
import {
  getMobileTrip,
  attachMobileBill,
  createMobileTrip,
  saveMobileDriver,
  updateMobileTrip,
  refreshMobileTripName,
} from "@/lib/mobile-trips";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { profileSchema, saveMobileProfile } from "@/lib/mobile-profile";
import {
  createMobileCompany,
  manualItemSchema,
  resolveManualProducts,
} from "@/lib/mobile-catalog";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const schema = z.discriminatedUnion("action", [
  profileSchema,
  z.object({
    action: z.literal("save_bill_trip"),
    requestId: z.uuid(),
    companyId: z.uuid(),
    driverId: z.uuid(),
    messageIds: z
      .array(z.uuid())
      .min(1)
      .max(30)
      .refine((ids) => new Set(ids).size === ids.length),
    name: z.string().trim().max(160).optional(),
  }),
  z.object({
    action: z.literal("trip_action"),
    tripId: z.uuid(),
    requestId: z.uuid(),
    operation: z.enum(["rename", "complete", "remove"]),
    name: z.string().trim().min(1).max(160).optional(),
  }),
  z.object({
    action: z.literal("company"),
    name: z.string().trim().min(1).max(200),
    gstin: z.string().min(1).max(100),
    allowSimilar: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("manual_dispatch"),
    requestId: z.uuid(),
    companyId: z.uuid(),
    destination: z.string().trim().min(1).max(200),
    driverId: z.uuid(),
    siteCount: z.number().int().min(1).max(1000).default(1),
    ownerName: z.string().trim().max(120).optional(),
    name: z.string().trim().max(160).optional(),
    items: z.array(manualItemSchema).min(1).max(30),
  }),
  z.object({
    action: z.literal("create_trip"),
    requestId: z.uuid().optional(),
    companyId: z.uuid().nullable().optional(),
    name: z.string().trim().max(160).optional(),
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
  const text = await request.text();
  if (text.length > 180000)
    return Response.json({ error: "Request too large" }, { status: 413 });
  const parsed = schema.safeParse(
    (() => {
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    })(),
  );
  if (!parsed.success)
    return Response.json(
      { error: "Check the entered details" },
      { status: 400 },
    );
  try {
    const b = parsed.data;
    if (b.action === "save_bill_trip") {
      const { data, error } = await getSupabaseAdmin().rpc(
        "mobile_save_bill_trip",
        {
          p_request_id: b.requestId,
          p_company_id: b.companyId,
          p_driver_id: b.driverId,
          p_message_ids: b.messageIds,
          p_name: b.name ?? null,
        },
      );
      if (error) throw new Error(error.message);
      // Derive a destination label after the atomic save; custom names survive.
      if (data?.status === "saved") await refreshMobileTripName(b.requestId);
      return Response.json(await getMobileTrip(b.requestId));
    }
    if (b.action === "company_profile")
      return Response.json(await saveMobileProfile(b));
    if (b.action === "trip_action") {
      const { error } = await getSupabaseAdmin().rpc("mobile_trip_action", {
        p_trip_id: b.tripId,
        p_request_id: b.requestId,
        p_action: b.operation,
        p_name: b.name ?? null,
      });
      if (error) throw new Error(error.message);
      return Response.json(await getMobileTrip(b.tripId));
    }
    if (b.action === "company") {
      const result = await createMobileCompany(b.name, b.gstin, b.allowSimilar);
      return Response.json(
        "status" in result
          ? {
              ...result,
              error:
                "A similar company exists. Check it before creating another.",
              code: result.status,
            }
          : result,
        { status: "status" in result ? 409 : 200 },
      );
    }
    if (b.action === "manual_dispatch") {
      const items = await resolveManualProducts(b.companyId, b.items);
      const { error } = await getSupabaseAdmin().rpc("mobile_manual_dispatch", {
        p_request_id: b.requestId,
        p_company_id: b.companyId,
        p_destination: b.destination,
        p_driver_id: b.driverId,
        p_site_count: b.siteCount,
        p_owner: b.ownerName ?? null,
        p_items: items,
      });
      if (error) throw new Error(error.message);
      if (b.name?.trim()) {
        const renamed = await getSupabaseAdmin().rpc("mobile_trip_action", {
          p_trip_id: b.requestId,
          p_request_id: b.requestId,
          p_action: "rename",
          p_name: b.name,
        });
        if (renamed.error) throw new Error(renamed.error.message);
      }
      return Response.json(await getMobileTrip(b.requestId));
    }
    if (b.action === "create_trip")
      return Response.json(
        await createMobileTrip(b.companyId ?? null, b.requestId, b.name),
      );
    if (b.action === "driver")
      return Response.json(await saveMobileDriver(b.name));
    if (b.action === "attach_bill")
      await attachMobileBill(b.tripId, b.messageId);
    if (b.action === "update_trip")
      await updateMobileTrip(b.tripId, b.driverId, b.close);
    return Response.json(await getMobileTrip(b.tripId), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Could not save" },
      { status: 409 },
    );
  }
}
