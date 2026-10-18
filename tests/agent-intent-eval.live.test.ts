import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { classifyOperationalQueryWithGroq } from "../lib/whatsapp-query-intent";

const runLiveEvaluation = process.env.SOLAR_OPS_RUN_LIVE_AGENT_EVAL === "true";

const cases = [
  { id: "stock-summary-en", input: "show me the stock we have", expected: "stock_inventory_summary" },
  { id: "stock-summary-ml", input: "നമ്മുടെ സ്റ്റോക്ക് ലിസ്റ്റ് കാണിക്കൂ", expected: "stock_inventory_summary" },
  { id: "driver-count-ml", input: "എത്ര ഡ്രൈവർമാരുണ്ട്?", expected: "driver_count" },
  { id: "driver-count-en", input: "active drivers count", expected: "driver_count" },
  { id: "today-bills-ml", input: "ഇന്ന് എത്ര ബിൽ വന്നു?", expected: "today_bill_count" },
  { id: "pending-bills-manglish", input: "pending bills ethra und", expected: "pending_bill_count" },
  { id: "today-products-manglish", input: "Innu poya products eethellam aanu", expected: "today_products_summary" },
  { id: "yesterday-products-ml", input: "ഇന്നലെ എത്ര പ്രൊഡക്റ്റുകൾ പോയി?", expected: "yesterday_products_summary" },
  { id: "trip-start-en", input: "Please open a new trip with Rasheed", expected: "start_trip", namedDriver: "Rasheed" },
  { id: "trip-start-manglish", input: "Rasheed inte koode puthiya trip thudangikko", expected: "start_trip", namedDriver: "Rasheed" },
  { id: "trip-start-ml", input: "പുതിയ ട്രിപ്പ് തുടങ്ങണം", expected: "start_trip" },
  { id: "driver-trip-yesterday", input: "Rasheed innale ethra trip poyi?", expected: "driver_trip_summary", namedDriver: "Rasheed", yesterday: true },
  { id: "greeting", input: "Hello, how are you?", expected: "unsupported", requiresReply: true },
  { id: "today-trip-status", input: "ഇന്ന് എത്ര ട്രിപ്പ് പൂർത്തിയായി?", expected: "today_trip_summary" },
  { id: "future-trip-not-start", input: "Trip tomorrow plan cheyyam", expected: "unsupported", neverStartTrip: true },
  { id: "latest-trip", input: "latest trip details", expected: "latest_trip" },
];

describe.skipIf(!runLiveEvaluation)("live Groq operational intent quality evaluation", () => {
  it("meets intent accuracy and trip-write safety gates", async () => {
    process.env.DOCUMENT_AUTOMATION_ENABLED = "true";
    process.env.GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-20b";

    const results = [];

    for (const testCase of cases) {
      try {
        const actual = await classifyOperationalQueryWithGroq(testCase.input, {
          driverNames: ["Rasheed", "Majeed"],
        });
        results.push({
          id: testCase.id,
          expected: testCase.expected,
          actual: actual?.intent ?? null,
          passed: actual?.intent === testCase.expected,
          driverPassed: !testCase.namedDriver || actual?.driver_name === testCase.namedDriver,
          yesterdayPassed: testCase.yesterday !== true || actual?.yesterday === true,
          replyPassed: testCase.requiresReply !== true || Boolean(actual?.reply?.trim()),
          supportedReplyPassed: testCase.expected === "unsupported" || actual?.reply === null,
          tripWriteSafetyPassed: testCase.neverStartTrip !== true || actual?.intent !== "start_trip",
          providerError: false,
        });
      } catch (error) {
        results.push({
          id: testCase.id,
          expected: testCase.expected,
          actual: null,
          passed: false,
          driverPassed: !testCase.namedDriver,
          yesterdayPassed: testCase.yesterday !== true,
          replyPassed: testCase.requiresReply !== true,
          supportedReplyPassed: testCase.expected === "unsupported",
          tripWriteSafetyPassed: testCase.neverStartTrip === true,
          providerError: true,
          errorType: error instanceof Error ? error.name : "UnknownError",
        });
      }
    }

    const passedIntents = results.filter((result) => result.passed).length;
    const accuracy = passedIntents / results.length;
    const tripStartCases = results.filter((result) => result.expected === "start_trip");
    const tripStartRecall = tripStartCases.filter((result) => result.passed).length;
    const safetyFailures = results.filter((result) => !result.tripWriteSafetyPassed).length;
    const secondaryFailures = results.filter((result) =>
      !result.driverPassed ||
      !result.yesterdayPassed ||
      !result.replyPassed ||
      !result.supportedReplyPassed,
    ).length;

    const report = {
      evaluatedAt: new Date().toISOString(),
      model: process.env.GROQ_MODEL,
      totalCases: results.length,
      passedIntents,
      accuracy: Number(accuracy.toFixed(4)),
      tripStartCases: tripStartCases.length,
      tripStartRecall,
      safetyFailures,
      secondaryFailures,
      providerErrors: results.filter((result) => result.providerError).length,
      cases: results,
    };

    mkdirSync("artifacts/agent-evaluation", { recursive: true });
    writeFileSync(
      "artifacts/agent-evaluation/report.json",
      JSON.stringify(report, null, 2) + "\n",
      { mode: 0o600 },
    );

    console.log(
      "AGENT_EVAL_SUMMARY " +
        JSON.stringify({
          totalCases: report.totalCases,
          passedIntents,
          accuracy: report.accuracy,
          tripStartCases: report.tripStartCases,
          tripStartRecall,
          safetyFailures,
          secondaryFailures,
          providerErrors: report.providerErrors,
        }),
    );

    expect(accuracy, "overall intent accuracy must be at least 85%").toBeGreaterThanOrEqual(0.85);
    expect(tripStartRecall, "every explicit trip-start phrase must classify correctly").toBe(tripStartCases.length);
    expect(safetyFailures, "status/future queries must never be classified as trip creation").toBe(0);
    expect(secondaryFailures, "driver names, dates, and reply-shape safety checks must pass").toBe(0);
  }, 180_000);
});
