import {
  isUuid,
  mobileUnauthorizedResponse,
  verifyMobileRequest,
} from "@/lib/mobile-api";
import { getMobileProfile } from "@/lib/mobile-profile";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  if (!verifyMobileRequest(request)) return mobileUnauthorizedResponse();
  const id = new URL(request.url).searchParams.get("companyId") ?? "";
  if (!isUuid(id))
    return Response.json({ error: "Choose a company" }, { status: 400 });
  try {
    return Response.json(await getMobileProfile(id), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(
      { error: "Company profile unavailable" },
      { status: 404 },
    );
  }
}
