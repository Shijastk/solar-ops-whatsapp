import { describe, expect, it } from "vitest";
import {
  normalizeStockGstin,
  normalizeStockName,
  normalizeStockUnit,
  validateOpeningStockInput,
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
        productName: "Solar panel",
        unit: "NOS",
        quantity: "0",
      }),
    ).toThrow();
  });
});
