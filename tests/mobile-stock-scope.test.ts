import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorized: vi.fn(),
  product: vi.fn(),
  stockIn: vi.fn(),
}));

vi.mock("@/lib/mobile-api", () => ({
  verifyMobileRequest: mocks.authorized,
  mobileUnauthorizedResponse: () => new Response(null, { status: 401 }),
}));
vi.mock("@/lib/supabase-admin", () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ single: mocks.product }) }) }),
    }),
  }),
}));
vi.mock("@/lib/stock", () => ({
  recordStockIn: mocks.stockIn,
  createOpeningStock: vi.fn(),
}));

import { POST } from "../app/api/mobile/v1/stock/opening/route";

const company = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const product = "33333333-3333-4333-8333-333333333333";

function request(body: Record<string, unknown> = {
  companyId: company,
  productId: product,
  productName: "Synthetic panel",
  unit: "NOS",
  quantity: 3,
  requestId: company,
}) {
  return new Request("https://ops.example.test/api/mobile/v1/stock/opening", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorized.mockReturnValue(true);
});

describe("existing product stock receipt company scope and idempotency", () => {
  it("refuses unauthenticated requests before reading or writing stock", async () => {
    mocks.authorized.mockReturnValue(false);

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(mocks.product).not.toHaveBeenCalled();
    expect(mocks.stockIn).not.toHaveBeenCalled();
  });

  it("requires a client request id for additive receipts instead of generating a new retry key", async () => {
    const response = await POST(request({
      companyId: company,
      productId: product,
      productName: "Synthetic panel",
      unit: "NOS",
      quantity: 3,
    }));

    expect(response.status).toBe(400);
    expect(mocks.product).not.toHaveBeenCalled();
    expect(mocks.stockIn).not.toHaveBeenCalled();
  });

  it("refuses another company product before writing stock", async () => {
    mocks.product.mockResolvedValue({
      data: { company_id: other },
      error: null,
    });

    const response = await POST(request());

    expect(response.status).toBe(409);
    expect(mocks.stockIn).not.toHaveBeenCalled();
  });

  it("returns a conflict when a receipt key is reused with a different payload", async () => {
    mocks.product.mockResolvedValue({
      data: { company_id: company },
      error: null,
    });
    mocks.stockIn.mockResolvedValue({
      status: "idempotency_conflict",
      product_id: product,
      reason: "stock_in_key_reused_with_different_payload",
    });

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe("idempotency_conflict");
    expect(body.error).toContain("request ID");
  });

  it("passes the same idempotency key through a retry of the same receipt", async () => {
    mocks.product.mockResolvedValue({
      data: { company_id: company },
      error: null,
    });
    mocks.stockIn
      .mockResolvedValueOnce({ status: "stock_in_applied" })
      .mockResolvedValueOnce({ status: "stock_in_already_applied" });

    const first = await POST(request());
    const retry = await POST(request());

    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    expect(mocks.stockIn).toHaveBeenCalledTimes(2);
    expect(mocks.stockIn).toHaveBeenNthCalledWith(1, {
      productId: product,
      quantity: 3,
      actionKey: company,
    });
    expect(mocks.stockIn).toHaveBeenNthCalledWith(2, {
      productId: product,
      quantity: 3,
      actionKey: company,
    });
  });
});
