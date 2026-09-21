import { getHealthConfiguration } from "@/lib/env";

export const runtime = "nodejs";

export async function GET() {
  const configuration = getHealthConfiguration();
  const configured = Object.values(configuration).every(Boolean);

  return Response.json(
    {
      ok: true,
      service: "solar-ops-whatsapp",
      configured,
      configuration,
      timestamp: new Date().toISOString(),
    },
    {
      status: configured ? 200 : 503,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
