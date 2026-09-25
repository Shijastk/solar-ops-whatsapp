import { describe, expect, it } from "vitest";
import { openingStockErrorState } from "../app/api/ops/stock/opening/route";

describe("opening stock route error mapping", () => {
  it("maps validation failures to safe UI states", () => {
    expect(openingStockErrorState("GSTIN is required for a new company")).toBe(
      "gstin_required",
    );
    expect(
      openingStockErrorState(
        "GSTIN must match the standard 15-character GSTIN format",
      ),
    ).toBe("invalid_gstin");
    expect(
      openingStockErrorState(
        "Select an existing company or enter a new company name",
      ),
    ).toBe("company_required");
    expect(openingStockErrorState("Product name is required")).toBe(
      "product_required",
    );
    expect(openingStockErrorState("Unit is invalid")).toBe("invalid_unit");
    expect(openingStockErrorState("HSN/SAC is invalid")).toBe("invalid_hsn");
  });

  it("falls back without exposing unknown error details to the UI", () => {
    expect(openingStockErrorState("database detail")).toBe("failed");
  });
});
