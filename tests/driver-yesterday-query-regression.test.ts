import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NormalizedWhatsAppMessage } from "../lib/whatsapp";

const { getSupabaseAdminMock, sendOpsReplyMock } = vi.hoisted(() => ({
  getSupabaseAdminMock: vi.fn(),
  sendOpsReplyMock: vi.fn(),
}));

vi.mock("@/lib/supabase-admin", () => ({
  getSupabaseAdmin: getSupabaseAdminMock,
}));
vi.mock("@/lib/replies", () => ({
  sendOpsReply: sendOpsReplyMock,
}));

import { handleFastWhatsAppQuery } from "../lib/whatsapp-queries";

const originalEnv = {
  enabled: process.env.DOCUMENT_AUTOMATION_ENABLED,
  key: process.env.GROQ_API_KEY,
  model: process.env.GROQ_MODEL,
};

describe("driver/date query end-to-end dispatch", () => {
  const queryCalls: Array<{ table: string; filters: Array<[string, ...unknown[]]> }> = [];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-19T06:00:00.000Z"));
    process.env.DOCUMENT_AUTOMATION_ENABLED = "true";
    process.env.GROQ_API_KEY = "groq-test-secret";
    process.env.GROQ_MODEL = "openai/gpt-oss-20b";
    queryCalls.length = 0;
    sendOpsReplyMock.mockResolvedValue(undefined);

    getSupabaseAdminMock.mockReturnValue({
      from(table: string) {
        const call = { table, filters: [] as Array<[string, ...unknown[]]> };
        queryCalls.push(call);
        const builder: Record<string, unknown> = {};
        for (const method of ["select", "eq", "gte", "lt", "order", "limit", "in"]) {
          builder[method] = (...args: unknown[]) => {
            call.filters.push([method, ...args]);
            return builder;
          };
        }
        builder.then = (resolve: (value: unknown) => unknown) => {
          let data: unknown[] = [];
          if (table === "ops_drivers") {
            data = [{ id: "driver-rasheed", name: "Rasheed" }, { id: "driver-majeed", name: "Majeed" }];
          } else if (table === "delivery_trips") {
            data = [{
              display_name: "Solar delivery",
              vehicle_number: "KL-11-AB-1234",
              driver_id: "driver-rasheed",
              finalized_at: "2026-10-18T12:00:00.000Z",
            }];
          }
          return Promise.resolve(resolve({ data, error: null }));
        };
        return builder;
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("keeps a named Manglish yesterday query driver-scoped through DB filtering and reply", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          intent: "yesterday_trip_summary",
          product_query: null,
          driver_name: null,
          yesterday: true,
          period: null,
          reply: null,
        }) } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
    ));

    const message = {
      type: "text",
      messageId: "test-driver-yesterday",
      senderPhone: "0000000000",
      timestamp: new Date("2026-10-19T06:00:00.000Z"),
      textBody: "Rasheed innale ethra trip poyi?",
    } as NormalizedWhatsAppMessage;

    await expect(handleFastWhatsAppQuery(message, "stored-message-id")).resolves.toBe("handled");

    const tripQuery = queryCalls.find((call) => call.table === "delivery_trips");
    expect(tripQuery?.filters).toContainEqual(["eq", "status", "ready"]);
    expect(tripQuery?.filters).toContainEqual(["eq", "driver_id", "driver-rasheed"]);
    expect(tripQuery?.filters).toContainEqual(["gte", "finalized_at", "2026-10-17T18:30:00.000Z"]);
    expect(tripQuery?.filters).toContainEqual(["lt", "finalized_at", "2026-10-18T18:30:00.000Z"]);
    expect(sendOpsReplyMock).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.stringContaining("ആകെ 1"),
    }));
    expect(sendOpsReplyMock.mock.calls[0][0].body).toContain("Solar delivery");
    expect(sendOpsReplyMock.mock.calls[0][0].body).toContain("Rasheed");
    expect(sendOpsReplyMock.mock.calls[0][0].body).not.toContain("Majeed");
  });
});
