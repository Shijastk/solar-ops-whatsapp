import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { classifyOperationalQueryWithGroq } from "../lib/whatsapp-query-intent";

const runLiveEvaluation = process.env.SOLAR_OPS_RUN_LIVE_AGENT_EVAL === "true";

const cases: Array<{
  id: string;
  input: string;
  expected: string;
  namedDriver?: string;
  yesterday?: boolean;
  driverNameMustBeNull?: boolean;
}> = [
  { id: "company-list-available-manglish", input: "Eethellam company ippol available aanu?", expected: "company_directory" },
  { id: "company-name-with-question", input: "Savtr Solar enna company ninakkariyamo?", expected: "company_directory" },
  { id: "company-name-alone", input: "Savtr Solar", expected: "company_directory" },
  { id: "company-products-available", input: "Savitr Solar products ethra available", expected: "company_directory" },
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
  { id: "driver-trip-yesterday-english", input: "How many trips did Rasheed make yesterday?", expected: "driver_trip_summary", namedDriver: "Rasheed", yesterday: true },
  { id: "driver-trip-yesterday-malayalam", input: "റഷീദ് ഇന്നലെ എത്ര ട്രിപ്പ് പോയി?", expected: "driver_trip_summary", namedDriver: "Rasheed", yesterday: true },
  { id: "driver-trip-yesterday-majeed", input: "Majeed innale ethra trip poyi?", expected: "driver_trip_summary", namedDriver: "Majeed", yesterday: true },
  { id: "driver-trip-all-time-manglish", input: "Majeedinte aake trip list cheyyamo", expected: "driver_trip_list", namedDriver: "Majeed" },
  { id: "unknown-driver-yesterday", input: "UnknownTestDriver innale ethra trip poyi?", expected: "unsupported", driverNameMustBeNull: true },
  { id: "partial-driver-name-collision", input: "Majeed P innale ethra trip poyi?", expected: "unsupported", driverNameMustBeNull: true },
  { id: "generic-yesterday-trip-count", input: "Innale ethra trips dispatch cheythu?", expected: "yesterday_trip_summary" },
  { id: "company-list-available", input: "Eethellam company ippol available aanu?", expected: "company_directory" },
  { id: "company-name-savtr-solar", input: "Savtr Solar enna company ninakkariyamo?", expected: "company_directory" },
  { id: "stock-list-manglish", input: "Stockil ippo ethokke products undu?", expected: "stock_inventory_summary" },
  { id: "stock-list-malayalam", input: "സ്റ്റോക്കിൽ ഏതൊക്കെ പ്രൊഡക്ട്സ് ഉണ്ട്.", expected: "stock_inventory_summary" },
  { id: "greeting", input: "Hello, how are you?", expected: "unsupported" },
  { id: "today-trip-status", input: "ഇന്ന് എത്ര ട്രിപ്പ് പൂർത്തിയായി?", expected: "today_trip_summary" },
  { id: "future-trip-not-start", input: "Trip tomorrow plan cheyyam", expected: "unsupported" },
  { id: "latest-trip", input: "latest trip details", expected: "latest_trip" },
];

function sanitizeModelReply(value: string | null | undefined): string | null {
  if (!value) return null;
  return value
    .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [redacted]")
    .replace(/\b(?:gsk_|sk-)[A-Za-z0-9_-]{8,}\b/g, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function sanitizeProviderError(error: unknown): { errorType: string; errorMessage: string } {
  const errorType = error instanceof Error ? error.name : "UnknownError";
  const rawMessage = error instanceof Error ? error.message : String(error);
  const errorMessage = rawMessage
    .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [redacted]")
    .replace(/\b(?:gsk_|sk-)[A-Za-z0-9_-]{8,}\b/g, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  return { errorType, errorMessage: errorMessage || "No error message provided" };
}

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
          actualDriverName: actual?.driver_name ?? null,
          actualYesterday: actual?.yesterday ?? null,
          actualReplyPreview: sanitizeModelReply(actual?.reply),
          passed: actual?.intent === testCase.expected,
          driverPassed: testCase.driverNameMustBeNull
            ? actual?.driver_name == null
            : !testCase.namedDriver || actual?.driver_name === testCase.namedDriver,
          yesterdayPassed: testCase.yesterday !== true || actual?.yesterday === true,
          replyPassed: testCase.expected !== "unsupported" || Boolean(actual?.reply?.trim()),
          supportedReplyPassed: testCase.expected === "unsupported" || actual?.reply === null,
          tripWriteSafetyPassed: testCase.expected === "start_trip" || actual?.intent !== "start_trip",
          providerError: false,
        });
      } catch (error) {
        results.push({
          id: testCase.id,
          expected: testCase.expected,
          actual: null,
          actualDriverName: null,
          actualYesterday: null,
          actualReplyPreview: null,
          passed: false,
          driverPassed: !testCase.namedDriver && !testCase.driverNameMustBeNull,
          yesterdayPassed: testCase.yesterday !== true,
          replyPassed: testCase.expected !== "unsupported",
          supportedReplyPassed: testCase.expected === "unsupported",
          // A provider error returns no classification, so it cannot authorize trip creation.
          tripWriteSafetyPassed: true,
          providerError: true,
          ...sanitizeProviderError(error),
        });
      }
    }

    const passedIntents = results.filter((result) => result.passed).length;
    const accuracy = passedIntents / results.length;
    const tripStartCases = results.filter((result) => result.expected === "start_trip");
    const tripStartRecall = tripStartCases.filter((result) => result.passed).length;
    const safetyFailures = results.filter((result) => result.expected !== "start_trip" && result.actual === "start_trip").length;
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
