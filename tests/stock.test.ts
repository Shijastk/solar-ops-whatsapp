import { describe, expect, it } from "vitest";
import {
  getStockGstinDiagnostics,
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

  it("reports safe diagnostics without exposing the GSTIN value", () => {
    expect(getStockGstinDiagnostics("GSTIN: 32ABMCS6908B1ZG")).toEqual({
      rawCodePointLength: 22,
      normalizedCodePointLength: 22,
      compactLength: 20,
      candidateCount: 1,
      outputLength: 15,
      outputMatchesGstinShape: true,
    });
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
