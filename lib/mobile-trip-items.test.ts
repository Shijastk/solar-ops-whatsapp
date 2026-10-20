import { describe, expect, it } from "vitest";
import { aggregateMobileTripItems } from "@/lib/mobile-trip-items";

describe("aggregateMobileTripItems", () => {
  it("combines repeated products across bills and preserves the first display name", () => {
    expect(
      aggregateMobileTripItems([
        {
          productName: "Emvee 610 Wp Topcon DCR Panel",
          quantity: 5,
          unit: "NOS",
          companyId: "company-a",
        },
        {
          productName: " emvee 610 wp topcon dcr panel ",
          quantity: 3,
          unit: "nos",
          companyId: "company-a",
        },
        {
          productName: "POM POWER 3 KW INVERTER",
          quantity: 1,
          unit: "NOS",
          companyId: "company-a",
        },
      ]),
    ).toEqual([
      {
        productName: "Emvee 610 Wp Topcon DCR Panel",
        quantity: 8,
        unit: "NOS",
        companyId: "company-a",
      },
      {
        productName: "POM POWER 3 KW INVERTER",
        quantity: 1,
        unit: "NOS",
        companyId: "company-a",
      },
    ]);
  });

  it("does not combine items across companies or units", () => {
    expect(
      aggregateMobileTripItems([
        { productName: "Panel", quantity: 5, unit: "NOS", companyId: "a" },
        { productName: "Panel", quantity: 2, unit: "SET", companyId: "a" },
        { productName: "Panel", quantity: 4, unit: "NOS", companyId: "b" },
      ]),
    ).toHaveLength(3);
  });

  it("keeps the quantity at zero and handles an empty list", () => {
    expect(
      aggregateMobileTripItems([
        { productName: "Cable", quantity: 0, unit: "MTR", companyId: null },
      ]),
    ).toEqual([
      { productName: "Cable", quantity: 0, unit: "MTR", companyId: null },
    ]);
    expect(aggregateMobileTripItems([])).toEqual([]);
  });
});
