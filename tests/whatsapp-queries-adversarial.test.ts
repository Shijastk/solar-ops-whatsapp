import { describe, expect, it } from "vitest";
import {
  mapAiClassificationToFastQuery,
  scoreCompanyNameMatch,
  resolveCompanyStockQueryCandidate,
} from "../lib/whatsapp-queries";
import type { AiOperationalQueryClassification } from "../lib/whatsapp-query-intent";

describe("semantic operational query mapping", () => {
  it("maps company-only stock requests to company inventory, without keyword stripping", () => {
    const classification = {
      intent: "company_directory",
      product_query: "Savitr Solar",
      driver_name: null,
      yesterday: false,
      period: null,
      reply: null,
      include_products: true,
    } satisfies AiOperationalQueryClassification;

    expect(mapAiClassificationToFastQuery(classification)).toEqual({
      type: "company_directory",
      companyName: "Savitr Solar",
      includeProducts: true,
    });
  });

  it("preserves company and product as separate semantic entities", () => {
    const classification = {
      intent: "stock_balance",
      product_query: "560W Topcon panel",
      company_name: "Savitr Solar",
      driver_name: null,
      yesterday: false,
      period: null,
      reply: null,
    } satisfies AiOperationalQueryClassification;

    expect(mapAiClassificationToFastQuery(classification)).toEqual({
      type: "stock_balance",
      productQuery: "560W Topcon panel",
      companyName: "Savitr Solar",
    });
  });

  it("maps semantic vehicle filters without parsing registration numbers from sentence position", () => {
    const classification = {
      intent: "trip_filter_summary",
      product_query: null,
      driver_name: null,
      yesterday: true,
      period: null,
      reply: null,
      filter_by: "vehicle",
      filter_value: "KL 11 AA 1234",
    } satisfies AiOperationalQueryClassification;

    expect(mapAiClassificationToFastQuery(classification)).toEqual({
      type: "trip_filter_summary",
      filterBy: "vehicle",
      filterValue: "KL 11 AA 1234",
      yesterday: true,
    });
  });

  it("resolves company names against the active company directory", () => {
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

  it("asks for clarification when a company query ambiguously matches multiple companies", () => {
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
});
