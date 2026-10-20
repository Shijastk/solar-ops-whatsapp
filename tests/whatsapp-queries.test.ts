import { describe, expect, it } from "vitest";
import {
  filterSafeFuzzyStockCandidates,
  formatCompanyStockSummary,
  formatStockInventorySummary,
  indiaDayBounds,
  mapAiClassificationToFastQuery,
  opsPeriodBounds,
  scoreCompanyNameMatch,
} from "../lib/whatsapp-queries";

describe("typed operational query helpers", () => {
  it("does not imply that unknown product quantities mean there is no stock", () => {
    const reply = formatCompanyStockSummary("SAVITR SOLAR SOLUTIONS LIMITED", [
      { product_name: "Deye inverter", unit: "pcs", current_quantity: null, balance_known: false },
      { product_name: "Solar panel", unit: "pcs", current_quantity: null, balance_known: false },
    ]);

    expect(reply).toContain("Quantity സ്ഥിരീകരിച്ച products: 0 / 2");
    expect(reply).toContain("Quantity സ്ഥിരീകരിച്ച് stock ഉള്ള products: 0");
    expect(reply).toContain("മൊത്തം stock ഇല്ലെന്ന് ഉറപ്പിക്കാൻ കഴിയില്ല");
    expect(reply).toContain("Deye inverter: quantity സ്ഥിരീകരിച്ചിട്ടില്ല");
  });

  it("states no stock only when every listed quantity is known and zero", () => {
    const reply = formatCompanyStockSummary("Example Solar", [
      { product_name: "Panel", unit: "pcs", current_quantity: 0, balance_known: true },
      { product_name: "Inverter", unit: "pcs", current_quantity: "0", balance_known: true },
    ]);

    expect(reply).toContain("സ്ഥിരീകരിച്ച quantity പ്രകാരം stock ഉള്ള products ഒന്നുമില്ല");
    expect(reply).not.toContain("മൊത്തം stock ഇല്ലെന്ന് ഉറപ്പിക്കാൻ കഴിയില്ല");
  });

  it("formats live stock rows without inventing unknown counts and caps the reply", () => {
    expect(
      formatStockInventorySummary([
        {
          company_name: "Savitr Solar",
          product_name: "560 Wp Panel",
          unit: "pcs",
          current_quantity: 12,
          balance_known: true,
        },
        {
          company_name: "Savitr Solar",
          product_name: "Inverter",
          unit: "pcs",
          current_quantity: 0,
          balance_known: false,
        },
      ]),
    ).toContain("560 Wp Panel: 12 pcs");
    expect(
      formatStockInventorySummary([
        {
          company_name: "Savitr Solar",
          product_name: "Inverter",
          unit: "pcs",
          current_quantity: 0,
          balance_known: false,
        },
      ]),
    ).toContain("Inverter: count ഇനിയും add ചെയ്തിട്ടില്ല");

    const manyRows = Array.from({ length: 21 }, (_, index) => ({
      company_name: "Company",
      product_name: "Product " + String(index + 1),
      unit: "pcs",
      current_quantity: 5,
      balance_known: true,
    }));
    const summary = formatStockInventorySummary(manyRows);
    expect(summary).toContain("ആദ്യത്തെ 20 entries");
    expect(summary).toContain("മറ്റു entries ഉണ്ട്");
    expect(summary).not.toContain("Product 21:");
  });

  it("maps a named-company stock summary to a company-filtered inventory query", () => {
    expect(
      mapAiClassificationToFastQuery({
        intent: "stock_inventory_summary",
        product_query: null,
        company_name: "Savitr Solar",
        driver_name: null,
        yesterday: false,
        period: null,
        reply: null,
      }),
    ).toEqual({
      type: "company_directory",
      companyName: "Savitr Solar",
      includeProducts: true,
    });
  });

  it("maps company directory classification to a read-only query", () => {
    expect(
      mapAiClassificationToFastQuery({
        intent: "company_directory",
        product_query: null,
        driver_name: null,
        yesterday: false,
        period: null,
        reply: null,
      }),
    ).toEqual({ type: "company_directory", companyName: null, includeProducts: false });
  });

  it("maps all-time driver trip list classifications to a typed read query", () => {
    expect(
      mapAiClassificationToFastQuery({
        intent: "driver_trip_list",
        product_query: null,
        driver_name: "Majeed",
        yesterday: false,
        period: null,
        reply: null,
      }),
    ).toEqual({ type: "driver_trip_list", driverName: "Majeed" });
  });

  it("never routes a trip-start action through the read-only query handler", () => {
    expect(
      mapAiClassificationToFastQuery({
        intent: "start_trip",
        product_query: null,
        driver_name: null,
        yesterday: false,
        period: null,
        reply: null,
      }),
    ).toBeNull();
  });

  it("calculates the current India day without depending on server timezone", () => {
    expect(
      indiaDayBounds(new Date("2026-10-03T10:16:00.000Z")),
    ).toEqual({
      start: "2026-10-02T18:30:00.000Z",
      end: "2026-10-03T18:30:00.000Z",
    });
  });

  it("calculates exact IST period bounds for structured summaries", () => {
    const now = new Date("2026-10-03T10:16:00.000Z");

    expect(opsPeriodBounds("this_month", now)).toEqual({
      start: "2026-09-30T18:30:00.000Z",
      end: "2026-10-03T10:16:00.000Z",
      label: "ഈ മാസം",
    });

    expect(opsPeriodBounds("last_month", now)).toEqual({
      start: "2026-08-31T18:30:00.000Z",
      end: "2026-09-30T18:30:00.000Z",
      label: "കഴിഞ്ഞ മാസം",
    });
  });

  it("allows typo-tolerant stock candidates without requiring exact spelling", () => {
    const matches = filterSafeFuzzyStockCandidates("Emvee 560 panel", [
      {
        product_id: "product-1",
        matched_name: "emmvee 560 wp topcon dcr panel",
        similarity_score: 0.61,
      },
      {
        product_id: "product-2",
        matched_name: "emmvee 560 wp topcon dcr panels",
        similarity_score: 0.58,
      },
    ]);

    expect(matches.map((match) => match.product_id)).toEqual([
      "product-1",
      "product-2",
    ]);
  });

  it("rejects a fuzzy product candidate when the model number conflicts", () => {
    expect(
      filterSafeFuzzyStockCandidates("Emmvee 580 panel", [
        {
          product_id: "product-560",
          matched_name: "emmvee 560 wp topcon dcr panel",
          similarity_score: 0.92,
        },
      ]),
    ).toEqual([]);
  });

  it("rejects weak fuzzy product candidates instead of guessing", () => {
    expect(
      filterSafeFuzzyStockCandidates("random product", [
        {
          product_id: "product-1",
          matched_name: "electrical fittings",
          similarity_score: 0.12,
        },
      ]),
    ).toEqual([]);
  });
});
