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
    const [data, trips, drivers] = await Promise.all([
      buildMobileBootstrap(new Date(), true),
      listMobileTrips(),
      listMobileDrivers(),
    ]);
    return Response.json(
      { ...data, trips, drivers },
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
