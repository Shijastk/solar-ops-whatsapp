import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ product: vi.fn(), stockIn: vi.fn() }));
vi.mock("@/lib/mobile-api", () => ({
  verifyMobileRequest: () => true,
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
const company = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222",
  product = "33333333-3333-4333-8333-333333333333";
function request() {
  return new Request("https://ops.example.test/api/mobile/v1/stock/opening", {
    method: "POST",
    body: JSON.stringify({
      companyId: company,
      productId: product,
      productName: "Synthetic panel",
      unit: "NOS",
      quantity: 3,
      requestId: company,
    }),
  });
}
beforeEach(() => vi.clearAllMocks());
describe("existing product stock receipt company scope", () => {
  it("refuses another company product before writing stock", async () => {
    mocks.product.mockResolvedValue({
      data: { company_id: other },
      error: null,
    });
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(mocks.stockIn).not.toHaveBeenCalled();
  });
  it("records an additive receipt with the same retry identity", async () => {
    mocks.product.mockResolvedValue({
      data: { company_id: company },
      error: null,
    });
    mocks.stockIn.mockResolvedValue({ status: "stock_in_applied" });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.stockIn).toHaveBeenCalledWith({
      productId: product,
      quantity: 3,
      actionKey: company,
    });
  });
});
