import { z } from "zod";
import {
  createOpsSession,
  getOpsSessionExpiresAt,
  isValidOpsAccessKey,
} from "@/lib/ops-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  accessKey: z.string().trim().min(1).max(512),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Invalid JSON" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success || !isValidOpsAccessKey(parsed.data.accessKey)) {
    return Response.json(
      { error: "Invalid access key" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const token = createOpsSession(Date.now(), 90 * 24 * 60 * 60 * 1000);
  const expiresAt = getOpsSessionExpiresAt(token);

  return Response.json(
    {
      token,
      expiresAt:
        expiresAt === null ? null : new Date(expiresAt).toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

