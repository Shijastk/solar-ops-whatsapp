import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import {
  OPS_SESSION_COOKIE,
  isSameOriginRequest,
  verifyOpsSession,
} from "@/lib/ops-auth";
import { adjustStockBalance } from "@/lib/stock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return Response.json({ error: "Invalid origin" }, { status: 403 });
  }

  const cookieStore = await cookies();
  if (!verifyOpsSession(cookieStore.get(OPS_SESSION_COOKIE)?.value)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const form = await request.formData();
    const result = await adjustStockBalance({
      productId: String(form.get("productId") ?? ""),
      targetQuantity: String(form.get("targetQuantity") ?? ""),
      actionKey: String(form.get("actionKey") ?? randomUUID()),
    });

    return Response.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown stock adjustment error";

    console.error("Stock adjustment failed", { message });

    return Response.json(
      {
        status: "failed",
      },
      { status: 400 },
    );
  }
}
