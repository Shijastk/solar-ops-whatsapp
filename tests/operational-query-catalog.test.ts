import { describe, expect, it } from "vitest";
import {
  AI_OPERATIONAL_INTENT_IDS,
  OPERATIONAL_QUERY_CATALOG,
  getOperationalQueryDefinition,
} from "@/lib/operational-query-catalog";

describe("canonical operational query catalogue", () => {
  it("has one definition for every classifier intent", () => {
    expect(Object.keys(OPERATIONAL_QUERY_CATALOG).sort()).toEqual(
      [...AI_OPERATIONAL_INTENT_IDS].sort(),
    );
    expect(new Set(AI_OPERATIONAL_INTENT_IDS).size).toBe(
      AI_OPERATIONAL_INTENT_IDS.length,
    );
  });

  it("marks trip creation as an action rather than a read query", () => {
    expect(getOperationalQueryDefinition("start_trip").kind).toBe("action");
    expect(getOperationalQueryDefinition("start_trip").status).toBe("action-separate");
  });

  it("requires exact driver and product entities for their respective queries", () => {
    expect(getOperationalQueryDefinition("driver_trip_summary").requiredEntities).toContain("driver");
    expect(getOperationalQueryDefinition("stock_balance").requiredEntities).toContain("product");
  });

  it("documents current date and trip status semantics instead of implying broader support", () => {
    expect(getOperationalQueryDefinition("driver_trip_summary").resultSemantics).toContain("today/yesterday only");
    expect(getOperationalQueryDefinition("today_trip_summary").resultSemantics).toContain("ready/finalized");
    expect(getOperationalQueryDefinition("ops_period_summary").resultSemantics).toContain("Asia/Kolkata");
  });

  it("has grounded examples and explicit data/result contracts for every intent", () => {
    for (const intent of AI_OPERATIONAL_INTENT_IDS) {
      const definition = getOperationalQueryDefinition(intent);
      expect(definition.description.trim().length).toBeGreaterThan(0);
      expect(definition.source.trim().length).toBeGreaterThan(0);
      expect(definition.resultSemantics.trim().length).toBeGreaterThan(0);
      expect(definition.examples.length).toBeGreaterThan(0);
    }
  });
});
