import { describe, expect, it } from "vitest";
import {
  isDriverRelatedQuestion,
  parseFastWhatsAppQuery,
  scoreCompanyNameMatch,
  resolveCompanyStockQueryCandidate,
} from "../lib/whatsapp-queries";

// Adversarial deterministic parser regression pack. This deliberately tests
// intent routing, not live business data or the external LLM provider.
const positiveSeeds: Array<{ id: string; input: string; type: string }> = [
  { id: "company-list-manglish", input: "eethellam company ippol available aanu", type: "company_directory" },
  { id: "company-list-english", input: "which companies are available", type: "company_directory" },
  { id: "company-list-malayalam", input: "ഏതെല്ലാം കമ്പനികൾ ഇപ്പോൾ ലഭ്യമാണ്", type: "company_directory" },
  { id: "company-list-malayalam-inflected", input: "എതെല്ലാം കമ്പനികളാണ് ഇപ്പോൾ ഉള്ളത്?", type: "company_directory" },
  { id: "company-name-typo", input: "Savtr Solar enna company ninakkariyamo", type: "company_directory" },
  { id: "company-products", input: "Savitr Solar products ethra available", type: "company_directory" },
  { id: "stock-summary-english", input: "show all stock", type: "stock_inventory_summary" },
  { id: "stock-summary-manglish", input: "stock list kaanikku", type: "stock_inventory_summary" },
  { id: "stock-summary-malayalam", input: "എല്ലാ സ്റ്റോക്കും കാണിക്കൂ", type: "stock_inventory_summary" },
  { id: "stock-balance", input: "Solar 560 panel stock ethra", type: "stock_balance" },
  { id: "today-products-english", input: "What products went out today", type: "today_products_summary" },
  { id: "today-products-manglish", input: "Innu poya products eethellam aanu", type: "today_products_summary" },
  { id: "yesterday-products", input: "Innale ethra products poyi", type: "yesterday_products_summary" },
  { id: "today-bills", input: "today bill count", type: "today_bill_count" },
  { id: "pending-bills", input: "How many bills need checking", type: "pending_bill_count" },
  { id: "latest-bill", input: "latest bill", type: "latest_bill" },
  { id: "vehicle-trips", input: "KL 11 AA 1234 trips today", type: "trip_filter_summary" },
  { id: "destination-trips", input: "How many trips to Tirur today", type: "trip_filter_summary" },
  { id: "period-summary", input: "this month summary", type: "ops_period_summary" },
  { id: "latest-trip", input: "latest trip details", type: "latest_trip" },
  { id: "yesterday-trip-count", input: "Innale ethra trips dispatch cheythu", type: "yesterday_trip_summary" },
];

const positiveScenarios = positiveSeeds.flatMap((seed) => [
  { id: seed.id + "-canonical", input: seed.input, expectedType: seed.type },
  { id: seed.id + "-uppercase", input: seed.input.toLocaleUpperCase("en"), expectedType: seed.type },
  { id: seed.id + "-extra-spaces", input: "  " + seed.input.replace(/ /g, "   ") + "  ", expectedType: seed.type },
  { id: seed.id + "-punctuation", input: "!!! " + seed.input + " ???", expectedType: seed.type },
  { id: seed.id + "-polite", input: "please " + seed.input + " please", expectedType: seed.type },
]);

const negativeScenarios = [
  "Hello",
  "Good morning",
  "Thanks",
  "ok",
  "8",
  "KL55AF7615",
  "I like solar panels",
  "What is a solar panel",
  "Explain how an inverter works",
  "Tomorrow maybe we can plan something",
  "Can you help me",
  "test test test",
  "company",
  "stock",
  "trip",
  "price",
  "How are you",
  "please",
  "നമസ്കാരം",
  "നന്ദി",
  "ഈ വാക്കിന്റെ അർത്ഥം എന്താണ്",
  "Can you translate this sentence",
  "Do not show stock, just explain the word stock",
  "I am not asking for a trip count",
].map((input, index) => ({ id: "negative-or-incomplete-" + (index + 1), input }));

describe("adversarial Solar Ops intent routing (100+ scenarios)", () => {
  it("contains at least 100 positive adversarial query variants", () => {
    expect(positiveScenarios.length + negativeScenarios.length).toBeGreaterThanOrEqual(100);
  });

  it.each(positiveScenarios)(
    "routes $id to the expected typed read intent",
    ({ input, expectedType }) => {
      expect(parseFastWhatsAppQuery(input)?.type).toBe(expectedType);
    },
  );

  it.each(negativeScenarios)(
    "does not confidently intercept $id",
    ({ input }) => {
      expect(parseFastWhatsAppQuery(input)).toBeNull();
    },
  );

  it("routes a company-only stock balance query to company-level resolution", () => {
    expect(resolveCompanyStockQueryCandidate("savitr solar", [
      "SAVITR SOLAR SOLUTIONS LIMITED",
    ])).toEqual({
      matchedCompany: "SAVITR SOLAR SOLUTIONS LIMITED",
      ambiguousCompanies: [],
    });
  });

  it("does not confuse a numeric solar product query with a company name", () => {
    expect(resolveCompanyStockQueryCandidate("Solar 560 panel", [
      "SAVITR SOLAR SOLUTIONS LIMITED",
    ])).toEqual({ matchedCompany: null, ambiguousCompanies: [] });
  });

  it("asks for clarification when company-only stock query matches multiple companies", () => {
    const result = resolveCompanyStockQueryCandidate("savitr solar solutions", [
      "SAVITR SOLAR SOLUTIONS LIMITED",
      "SAVITR SOLAR SOLUTIONS PRIVATE LIMITED",
    ]);
    expect(result.matchedCompany).toBeNull();
    expect(result.ambiguousCompanies).toHaveLength(2);
  });

  it.each([
    ["Savtr Solar", "SAVITR SOLAR SOLUTIONS LIMITED"],
    ["savitr solar solutions ltd", "SAVITR SOLAR SOLUTIONS LIMITED"],
    ["SAVITR SOLAR SOLUTIONS LIMITED", "SAVITR SOLAR SOLUTIONS LIMITED"],
    ["Savitr-Solar", "SAVITR SOLAR SOLUTIONS LIMITED"],
    ["Savitr Solar Pvt Ltd", "SAVITR SOLAR SOLUTIONS LIMITED"],
    ["Nexon", "NEXON SOLAR LIMITED"],
    ["Nexon Solar Ltd", "NEXON SOLAR LIMITED"],
  ])("tolerates company-name spelling/legal-suffix variation: %s", (query, canonical) => {
    expect(scoreCompanyNameMatch(query, canonical)).toBeGreaterThanOrEqual(0.62);
  });

  it.each([
    "Rasheed innale ethra trip poyi",
    "How many trips did Majeed make yesterday",
    "UnknownDriver innale ethra trip poyi",
    "ഡ്രൈവർ റഷീദിന് എത്ര ട്രിപ്പ്",
    "ഇന്ന് പോയത് ഡ്രൈവർ റഷീദ് ആയിരുന്നോ",
  ])("keeps named-driver queries out of generic deterministic routing: %s", (input) => {
    expect(isDriverRelatedQuestion(input)).toBe(true);
    expect(parseFastWhatsAppQuery(input)).toBeNull();
  });
});

