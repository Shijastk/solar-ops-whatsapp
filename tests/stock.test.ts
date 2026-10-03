import { describe, expect, it } from "vitest";
import {
  decideOpeningProductDuplicate,
  normalizeProductIdentityName,
  normalizeStockGstin,
  normalizeStockName,
  normalizeStockUnit,
  validateOpeningStockInput,
  validateStockAdjustmentInput,
} from "../lib/stock";

describe("stock input helpers", () => {
  it("normalizes spelling separators without guessing product identity", () => {
    expect(normalizeStockName("  Sun-Grid  SOLUTIONS Ltd. ")).toBe(
      "sun grid solutions ltd",
    );
    expect(normalizeStockUnit(" No.s ")).toBe("NOS");
  });

  it("normalizes pasted GSTIN punctuation and invisible characters before validation", () => {
    expect(normalizeStockGstin(" 32ABMCS6908B1ZG,\u200B ")).toBe(
      "32ABMCS6908B1ZG",
    );

    expect(
      validateOpeningStockInput({
        companyName: "Sun Grid Solutions",
        companyGstin: "32ABMCS6908B1ZG,\u200B",
        productName: "Solar panel",
        unit: "NOS",
        quantity: "18",
      }).companyGstin,
    ).toBe("32ABMCS6908B1ZG");
  });

  it("extracts one valid GSTIN from copied label text", () => {
    expect(
      normalizeStockGstin("Company GSTIN: 32ABMCS6908B1ZG, Kerala"),
    ).toBe("32ABMCS6908B1ZG");

    expect(
      validateOpeningStockInput({
        companyName: "Sun Grid Solutions",
        companyGstin: "GSTIN: 32ABMCS6908B1ZG",
        productName: "Solar panel",
        unit: "NOS",
        quantity: "18",
      }).companyGstin,
    ).toBe("32ABMCS6908B1ZG");
  });

  it("accepts NFKC-compatible full-width pasted GSTIN text", () => {
    expect(normalizeStockGstin("３２ＡＢＭＣＳ６９０８Ｂ１ＺＧ")).toBe(
      "32ABMCS6908B1ZG",
    );
  });

  it("rejects ambiguous text containing more than one GSTIN", () => {
    expect(() =>
      validateOpeningStockInput({
        companyName: "Sun Grid Solutions",
        companyGstin:
          "32ABMCS6908B1ZG and 32ABCDE1234F1Z5",
        productName: "Solar panel",
        unit: "NOS",
        quantity: "18",
      }),
    ).toThrow("standard 15-character GSTIN format");
  });

  it("requires GSTIN when creating a new stock company", () => {
    expect(() =>
      validateOpeningStockInput({
        companyName: "Sun Grid Solutions",
        productName: "Solar panel",
        unit: "NOS",
        quantity: "18",
      }),
    ).toThrow("GSTIN is required");
  });

  it("allows an existing company id without retyping its saved GSTIN", () => {
    expect(
      validateOpeningStockInput({
        companyId: "11111111-1111-4111-8111-111111111111",
        productName: "Solar panel",
        unit: "NOS",
        quantity: "18",
      }),
    ).toMatchObject({
      companyId: "11111111-1111-4111-8111-111111111111",
      companyGstin: null,
    });
  });

  it("validates opening stock and creates deterministic normalized fields", () => {
    expect(
      validateOpeningStockInput({
        companyName: "Sun Grid Solutions",
        companyGstin: "32abcde1234f1z5",
        productName: "Solar 560-Wp TOPCon Panel",
        unit: "nos",
        hsnSac: "8541",
        quantity: "100.500",
      }),
    ).toMatchObject({
      companyName: "Sun Grid Solutions",
      companyGstin: "32ABCDE1234F1Z5",
      companyNormalized: "sun grid solutions",
      productNormalized: "solar 560 wp topcon panel",
      unit: "NOS",
      unitNormalized: "NOS",
      hsnSac: "8541",
      quantity: 100.5,
    });
  });

  it("blocks invalid opening quantities and ambiguous empty companies", () => {
    expect(() =>
      validateOpeningStockInput({
        productName: "Solar panel",
        unit: "NOS",
        quantity: "10",
      }),
    ).toThrow("Select an existing company");

    expect(() =>
      validateOpeningStockInput({
        companyName: "Company",
        companyGstin: "32ABCDE1234F1Z5",
        productName: "Solar panel",
        unit: "NOS",
        quantity: "0",
      }),
    ).toThrow();
  });

  it("accepts zero or positive target quantities for audited stock adjustments", () => {
    expect(
      validateStockAdjustmentInput({
        productId: "11111111-1111-4111-8111-111111111111",
        targetQuantity: "0",
      }),
    ).toEqual({
      productId: "11111111-1111-4111-8111-111111111111",
      targetQuantity: 0,
    });

    expect(
      validateStockAdjustmentInput({
        productId: "11111111-1111-4111-8111-111111111111",
        targetQuantity: "25.500",
      }).targetQuantity,
    ).toBe(25.5);
  });

  it("rejects negative or invalid stock adjustment targets", () => {
    expect(() =>
      validateStockAdjustmentInput({
        productId: "11111111-1111-4111-8111-111111111111",
        targetQuantity: "-1",
      }),
    ).toThrow();

    expect(() =>
      validateStockAdjustmentInput({
        productId: "not-a-product-id",
        targetQuantity: "10",
      }),
    ).toThrow();
  });

  it("treats safe singular/plural product wording as the same deterministic identity", () => {
    expect(
      normalizeProductIdentityName("Emmvee 560 Wp Topcon Dcr Panels"),
    ).toBe(
      normalizeProductIdentityName("Emmvee 560 Wp Topcon Dcr Panel"),
    );

    expect(normalizeProductIdentityName("Electrical Fittings")).toBe(
      normalizeProductIdentityName("Electrical Fitting"),
    );
  });

  it("keeps model-number and meaningful-token differences distinct", () => {
    expect(
      normalizeProductIdentityName("Emmvee 580 Wp Topcon Dcr Panel"),
    ).not.toBe(
      normalizeProductIdentityName("Emmvee 560 Wp Topcon Dcr Panel"),
    );

    expect(
      normalizeProductIdentityName("Emmvee 560 Wp Topcon Non Dcr Panel"),
    ).not.toBe(
      normalizeProductIdentityName("Emmvee 560 Wp Topcon Dcr Panel"),
    );
  });

  it("blocks a hard-equivalent duplicate even when similar-product override is enabled", () => {
    expect(
      decideOpeningProductDuplicate({
        productName: "Emmvee 560 Wp Topcon Dcr Panels",
        allowSimilarProduct: true,
        candidates: [
          {
            product_id: "11111111-1111-4111-8111-111111111111",
            company_id: "22222222-2222-4222-8222-222222222222",
            canonical_name: "Emmvee 560 Wp Topcon Dcr Panel",
            unit: "NOS",
            hsn_sac: null,
            similarity_score: 0.96,
          },
        ],
      }),
    ).toEqual({
      status: "opening_exists",
      product_id: "11111111-1111-4111-8111-111111111111",
      product_name: "Emmvee 560 Wp Topcon Dcr Panel",
    });
  });

  it("still allows an explicit override for merely similar but genuinely distinct products", () => {
    expect(
      decideOpeningProductDuplicate({
        productName: "Emmvee 560 Wp Topcon Non Dcr Panel",
        allowSimilarProduct: true,
        candidates: [
          {
            product_id: "11111111-1111-4111-8111-111111111111",
            company_id: "22222222-2222-4222-8222-222222222222",
            canonical_name: "Emmvee 560 Wp Topcon Dcr Panel",
            unit: "NOS",
            hsn_sac: null,
            similarity_score: 0.9,
          },
        ],
      }),
    ).toBeNull();
  });

  it("keeps local typo similarity as a warning when no override is given", () => {
    expect(
      decideOpeningProductDuplicate({
        productName: "Emvee 560 Wp Topcon Dcr Panel",
        allowSimilarProduct: false,
        candidates: [
          {
            product_id: "11111111-1111-4111-8111-111111111111",
            company_id: "22222222-2222-4222-8222-222222222222",
            canonical_name: "Emmvee 560 Wp Topcon Dcr Panel",
            unit: "NOS",
            hsn_sac: null,
            similarity_score: 0.94,
          },
        ],
      }),
    ).toEqual({
      status: "potential_product_duplicate",
      product_id: "11111111-1111-4111-8111-111111111111",
      product_name: "Emmvee 560 Wp Topcon Dcr Panel",
    });
  });
});
