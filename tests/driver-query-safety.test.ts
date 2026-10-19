import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NormalizedWhatsAppMessage } from "../lib/whatsapp";

const { getSupabaseAdminMock, sendOpsReplyMock } = vi.hoisted(() => ({
  getSupabaseAdminMock: vi.fn(),
  sendOpsReplyMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/supabase-admin", () => ({
  getSupabaseAdmin: getSupabaseAdminMock,
}));
vi.mock("@/lib/replies", () => ({
  sendOpsReply: sendOpsReplyMock,
}));

import { handleFastWhatsAppQuery } from "../lib/whatsapp-queries";

type Filter = [column: string, value: unknown];

function mockSupabaseDirectory() {
  const from = vi.fn((table: string) => {
    const state: { selection: string; filters: Filter[] } = {
      selection: "",
      filters: [],
    };
    const result = () => {
      if (
        table === "ops_drivers" &&
        state.selection === "name" &&
        state.filters.some(([column, value]) => column === "active" && value === true)
      ) {
        return {
          data: [{ name: "Majeed" }, { name: "Rasheed" }],
          error: null,
        };
      }

      // Synthetic directory: neither unknown test name is an exact match.
      if (
        table === "ops_drivers" &&
        state.selection === "id, name" &&
        state.filters.some(([column]) => column === "normalized_name")
      ) {
        return { data: [], error: null };
      }

      if (table === "delivery_trips") {
        return { data: [], error: null, count: 0 };
      }

      return { data: [], error: null, count: 0 };
    };

    const query: any = {
      select(selection: string) {
        state.selection = selection;
        return query;
      },
      eq(column: string, value: unknown) {
        state.filters.push([column, value]);
        return query;
      },
      gte() {
        return query;
      },
      lt() {
        return query;
      },
      order() {
        return query;
      },
      limit() {
        return Promise.resolve(result());
      },
      then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
        return Promise.resolve(result()).then(resolve, reject);
      },
    };

    return query;
  });

  getSupabaseAdminMock.mockReturnValue({ from });
}

function inbound(textBody: string): NormalizedWhatsAppMessage {
  return {
    senderPhone: "synthetic-sender",
    messageId: "synthetic-message",
    timestamp: new Date("2026-10-19T12:00:00.000Z"),
    type: "text",
    textBody,
  };
}

function mockGroqIntent(intent: string, driverName: string | null = null) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{
            message: {
              content: JSON.stringify({
                intent,
                product_query: null,
                driver_name: driverName,
                yesterday: true,
                period: null,
                reply: null,
              }),
            },
          }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    ),
  );
}

beforeEach(() => {
  process.env.DOCUMENT_AUTOMATION_ENABLED = "true";
  process.env.GROQ_API_KEY = "synthetic-test-key";
  process.env.GROQ_MODEL = "openai/gpt-oss-20b";
  mockSupabaseDirectory();
  sendOpsReplyMock.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.GROQ_API_KEY;
});

describe("named-driver response safety", () => {
  it("does not turn an unknown named-driver query into a company-wide count", async () => {
    mockGroqIntent("yesterday_trip_summary");

    await handleFastWhatsAppQuery(
      inbound("UnknownTestDriver innale ethra trip poyi?"),
      "synthetic-inbound-id",
    );

    expect(sendOpsReplyMock).toHaveBeenCalledTimes(1);
    expect(sendOpsReplyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining("Driver directory"),
      }),
    );
    expect(sendOpsReplyMock.mock.calls[0][0].body).not.toContain("completed trips (ആകെ");
  });

  it("does not fuzzy-match an unknown driver to an active driver's trips", async () => {
    mockGroqIntent("driver_trip_summary", "Majeed2");

    await handleFastWhatsAppQuery(
      inbound("Majeed2 innale ethra trip poyi?"),
      "synthetic-inbound-id",
    );

    expect(sendOpsReplyMock).toHaveBeenCalledTimes(1);
    expect(sendOpsReplyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining("Driver directory"),
      }),
    );
    expect(sendOpsReplyMock.mock.calls[0][0].body).not.toContain("completed trips (ആകെ");
  });
});
