import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  buildMobileBootstrap,
  mobileUnauthorizedResponse,
  verifyMobileRequest,
} from "@/lib/mobile-api";
import { listMobileDrivers, listMobileTrips } from "@/lib/mobile-trips";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  if (!verifyMobileRequest(request)) return mobileUnauthorizedResponse();
  try {
    const [data, trips, drivers, totals] = await Promise.all([
      buildMobileBootstrap(new Date(), true),
      listMobileTrips(),
      listMobileDrivers(),
      getSupabaseAdmin().rpc("get_mobile_today_totals"),
    ]);
    if (totals.error) throw new Error("Could not load daily bill totals");
    const todayTotals = (totals.data ?? []).map(
      (r: {
        company_id: string | null;
        bill_count: number;
        total_amount: number;
      }) => ({
        companyId: r.company_id,
        billCount: Number(r.bill_count),
        totalAmount: Number(r.total_amount),
      }),
    );
    return Response.json(
      { ...data, trips, drivers, todayTotals },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    console.error("Mobile home failed", {
      reason: e instanceof Error ? e.message : "Unknown",
    });
    return Response.json(
      { error: "Could not refresh. Try again." },
      { status: 500 },
    );
  }
}
