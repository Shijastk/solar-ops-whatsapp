import { describe, expect, it } from "vitest";
import {
  filterSafeFuzzyStockCandidates,
  formatStockInventorySummary,
  isDriverRelatedQuestion,
  indiaDayBounds,
  mapAiClassificationToFastQuery,
  opsPeriodBounds,
  parseFastWhatsAppQuery,
} from "../lib/whatsapp-queries";

describe("fast WhatsApp operational query parsing", () => {
  it("recognizes bounded bill-count intents without AI", () => {
    expect(parseFastWhatsAppQuery("ഇന്ന് എത്ര ബിൽ വന്നു?")).toEqual({
      type: "today_bill_count",
    });
    expect(parseFastWhatsAppQuery("today bill count")).toEqual({
      type: "today_bill_count",
    });
    expect(parseFastWhatsAppQuery("pending bill ethra")).toEqual({
      type: "pending_bill_count",
    });
    expect(parseFastWhatsAppQuery("How many bills need checking?")).toEqual({
      type: "pending_bill_count",
    });
    expect(parseFastWhatsAppQuery("ഇന്ന് എത്ര ബില്ലുകൾ ചെക്ക് ചെയ്യണം?")).toEqual({
      type: "pending_bill_count",
    });
    expect(parseFastWhatsAppQuery("latest bill")).toEqual({
      type: "latest_bill",
    });
    expect(parseFastWhatsAppQuery("ഇന്നത്തെ trip ഏതാണ്?")).toEqual({
      type: "today_trip_summary",
    });
    expect(parseFastWhatsAppQuery("latest trip")).toEqual({
      type: "latest_trip",
    });
    expect(
      parseFastWhatsAppQuery("Innu poya products eethellam aanu"),
    ).toEqual({ type: "today_products_summary" });
    expect(
      parseFastWhatsAppQuery("What products went out today?"),
    ).toEqual({ type: "today_products_summary" });
    expect(parseFastWhatsAppQuery("ഇന്ന് എത്ര പ്രൊഡക്റ്റുകൾ പോയി?")).toEqual({
      type: "today_products_summary",
    });
    expect(parseFastWhatsAppQuery("Inn ethra stock despatch aayi")).toEqual({
      type: "today_products_summary",
    });
    expect(parseFastWhatsAppQuery("Innale ethra products poyi")).toEqual({
      type: "yesterday_products_summary",
    });
    expect(parseFastWhatsAppQuery("ഇന്നലെ എത്ര പ്രൊഡക്റ്റുകൾ പോയി?")).toEqual({
      type: "yesterday_products_summary",
    });
    expect(parseFastWhatsAppQuery("Yesterday how much trip")).toEqual({
      type: "yesterday_trip_summary",
    });
    expect(parseFastWhatsAppQuery("today driver Rasheed trips")).toBeNull();
    expect(parseFastWhatsAppQuery("ഈ മാസം summary")).toEqual({
      type: "ops_period_summary",
      period: "this_month",
    });
    expect(parseFastWhatsAppQuery("last year summary")).toEqual({
      type: "ops_period_summary",
      period: "last_year",
    });
  });

  it("parses exact vehicle and destination trip filters without intercepting trip creation", () => {
    expect(parseFastWhatsAppQuery("KL 11 AA 1234 trips today")).toEqual({
      type: "trip_filter_summary",
      filterBy: "vehicle",
      filterValue: "KL11AA1234",
      yesterday: false,
    });
    expect(parseFastWhatsAppQuery("KL11AA1234 innale ethra trip poyi")).toEqual({
      type: "trip_filter_summary",
      filterBy: "vehicle",
      filterValue: "KL11AA1234",
      yesterday: true,
    });
    expect(parseFastWhatsAppQuery("How many trips to Tirur today")).toEqual({
      type: "trip_filter_summary",
      filterBy: "destination",
      filterValue: "tirur",
      yesterday: false,
    });
    expect(parseFastWhatsAppQuery("show trips to Kottakkal yesterday")).toEqual({
      type: "trip_filter_summary",
      filterBy: "destination",
      filterValue: "kottakkal",
      yesterday: true,
    });
    expect(parseFastWhatsAppQuery("new trip to Tirur")).toBeNull();
    expect(parseFastWhatsAppQuery("new trip KL11AA1234")).toBeNull();
  });

  it("routes named-driver trip queries to semantic classification rather than a general trip count", () => {
    expect(parseFastWhatsAppQuery("റഷീദ് എന്ന ഡ്രൈവർ ഇന്ന് എത്ര ട്രിപ്പ് പോയിട്ടുണ്ട്?")).toBeNull();
    expect(parseFastWhatsAppQuery("ഡ്രൈവർ റഷീദിന് എത്ര ട്രിപ്പ്?")).toBeNull();
    expect(parseFastWhatsAppQuery("ഇന്നലെ രാത്രി പോയ ഡ്രൈവർ റഷീദ് ആയിരുന്നോ?")).toBeNull();
    expect(parseFastWhatsAppQuery("എത്ര ഡ്രൈവർമാരുണ്ട്?")).toBeNull();
    expect(parseFastWhatsAppQuery("Rasheed innale ethra trip poyi?")).toBeNull();
    expect(parseFastWhatsAppQuery("Majeed innale ethra trip poyi?")).toBeNull();
    expect(parseFastWhatsAppQuery("UnknownTestDriver innale ethra trip poyi?")).toBeNull();
    expect(parseFastWhatsAppQuery("How many trips did Majeed make yesterday?")).toBeNull();
    expect(parseFastWhatsAppQuery("Innale ethra trips dispatch cheythu?")).toEqual({
      type: "yesterday_trip_summary",
    });
  });

  it("detects named-driver trip questions without hardcoding a specific driver", () => {
    expect(isDriverRelatedQuestion("Innu poya driver Rasheed ariyamo?")).toBe(true);
    expect(isDriverRelatedQuestion("ഇന്ന് പോയത് ഡ്രൈവർ റഷീദായിരുന്നു")).toBe(true);
    expect(isDriverRelatedQuestion("Rasheed innale ethra trip poyi?")).toBe(true);
    expect(isDriverRelatedQuestion("Majeed innale ethra trip poyi?")).toBe(true);
    expect(isDriverRelatedQuestion("UnknownTestDriver innale ethra trip poyi?")).toBe(true);
    expect(isDriverRelatedQuestion("Innale ethra trips dispatch cheythu?")).toBe(false);
    expect(isDriverRelatedQuestion("How many trips did Majeed make yesterday?")).toBe(true);
    expect(isDriverRelatedQuestion("How many trips did we make yesterday?")).toBe(false);
    expect(isDriverRelatedQuestion("latest bill")).toBe(false);
  });

  it("extracts the product phrase from Malayalam and Manglish stock questions", () => {
    expect(
      parseFastWhatsAppQuery("Emmvee 560 Wp Topcon Dcr Panel സ്റ്റോക്ക് എത്ര?"),
    ).toEqual({
      type: "stock_balance",
      productQuery: "Emmvee 560 Wp Topcon Dcr Panel",
    });

    expect(parseFastWhatsAppQuery("Solar 560 panel stock ethra")).toEqual({
      type: "stock_balance",
      productQuery: "Solar 560 panel",
    });

    expect(parseFastWhatsAppQuery("Emvee 560 panel stock undu")).toEqual({
      type: "stock_balance",
      productQuery: "Emvee 560 panel",
    });
    expect(parseFastWhatsAppQuery("Emvee 560 panel stock undo")).toEqual({
      type: "stock_balance",
      productQuery: "Emvee 560 panel",
    });
  });

  it("recognizes broad stock inventory list requests without guessing a product", () => {
    expect(parseFastWhatsAppQuery("show all stock")).toEqual({
      type: "stock_inventory_summary",
    });
    expect(parseFastWhatsAppQuery("stock list kaanikku")).toEqual({
      type: "stock_inventory_summary",
    });
    expect(parseFastWhatsAppQuery("എല്ലാ സ്റ്റോക്കും കാണിക്കൂ")).toEqual({
      type: "stock_inventory_summary",
    });
    expect(parseFastWhatsAppQuery("Which products are in stock?")).toEqual({
      type: "stock_inventory_summary",
    });
    expect(parseFastWhatsAppQuery("Stockil ippo ethokke products undu?")).toEqual({
      type: "stock_inventory_summary",
    });
    expect(parseFastWhatsAppQuery("സ്റ്റോക്കിൽ ഏതൊക്കെ പ്രൊഡക്ട്സ് ഉണ്ട്")).toEqual({
      type: "stock_inventory_summary",
    });
    expect(parseFastWhatsAppQuery("Emmvee 560 panel stock ethra")).toEqual({
      type: "stock_balance",
      productQuery: "Emmvee 560 panel",
    });
  });

  it("asks for a product instead of guessing when a stock question is incomplete", () => {
    expect(parseFastWhatsAppQuery("സ്റ്റോക്ക് എത്ര?")).toEqual({
      type: "stock_product_required",
    });
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

  it("does not intercept arbitrary text or correction-only values", () => {
    expect(parseFastWhatsAppQuery("Hello")).toBeNull();
    expect(parseFastWhatsAppQuery("8")).toBeNull();
    expect(parseFastWhatsAppQuery("KL55AF7615")).toBeNull();
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
