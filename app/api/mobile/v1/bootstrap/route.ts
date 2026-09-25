import { getOpsSessionExpiresAt } from "@/lib/ops-auth";
import {
  buildMobileBootstrap,
  mobileUnauthorizedResponse,
  readMobileBearerToken,
  verifyMobileRequest,
} from "@/lib/mobile-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!verifyMobileRequest(request)) {
    return mobileUnauthorizedResponse();
  }

  const token = readMobileBearerToken(request);
  const expiresAt = getOpsSessionExpiresAt(token ?? undefined);

  try {
    const data = await buildMobileBootstrap();
    return Response.json(
      {
        ...data,
        sessionExpiresAt:
          expiresAt === null ? null : new Date(expiresAt).toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Mobile bootstrap failed", {
      message:
        error instanceof Error ? error.message.slice(0, 300) : "Unknown error",
    });
    return Response.json(
      { error: "Unable to load operations data" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
