import {
  isUuid,
  mobileUnauthorizedResponse,
  verifyMobileRequest,
} from "@/lib/mobile-api";
import { getMobileBill, searchMobileBills } from "@/lib/mobile-bills";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  if (!verifyMobileRequest(request)) return mobileUnauthorizedResponse();
  const p = new URL(request.url).searchParams,
    id = p.get("id"),
    companyId = p.get("companyId");
  if ((id && !isUuid(id)) || (companyId && !isUuid(companyId)))
    return Response.json({ error: "Invalid bill or company" }, { status: 400 });
  try {
    if (id) {
      const bill = await getMobileBill(id);
      return Response.json(bill ?? { error: "Bill unavailable" }, {
        status: bill ? 200 : 404,
        headers: { "Cache-Control": "no-store" },
      });
    }
    return Response.json(
      { bills: await searchMobileBills(p.get("q") ?? "", companyId) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json({ error: "Could not load bills" }, { status: 500 });
  }
}
