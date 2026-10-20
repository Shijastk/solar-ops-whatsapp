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

vi.mock("@/lib/whatsapp-query-intent", () => ({
  classifyOperationalQueryWithGroq: vi.fn().mockResolvedValue({
    intent: "unsupported",
    product_query: null,
    driver_name: null,
    yesterday: false,
    period: null,
    reply: "Driver directory-ൽ ഈ പേര് കൃത്യമായി കണ്ടെത്താനായില്ല. പേര് confirm ചെയ്യൂ.",
  }),
}));

import { handleFastWhatsAppQuery } from "../lib/whatsapp-queries";

type Filter = [column: string, value: unknown];
type QueryResult = { data: unknown[]; error: null; count?: number };
type QueryBuilder = PromiseLike<QueryResult> & {
  select(selection: string): QueryBuilder;
  eq(column: string, value: unknown): QueryBuilder;
  gte(...args: unknown[]): QueryBuilder;
  lt(...args: unknown[]): QueryBuilder;
  order(...args: unknown[]): QueryBuilder;
  limit(count: number): Promise<QueryResult>;
};
const originalEnv = {
  enabled: process.env.DOCUMENT_AUTOMATION_ENABLED,
  key: process.env.GROQ_API_KEY,
  model: process.env.GROQ_MODEL,
};

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

      if (table === "ops_drivers" && state.selection === "id, name") {
        // If fuzzy matching regresses, this synthetic directory would resolve
        // "Majeed2" to Majeed and the safety assertion below would fail.
        return {
          data: [
            { id: "synthetic-majeed-id", name: "Majeed" },
            { id: "synthetic-rasheed-id", name: "Rasheed" },
          ],
          error: null,
        };
      }

      if (table === "delivery_trips") {
        return { data: [], error: null, count: 0 };
      }

      return { data: [], error: null, count: 0 };
    };

    const query: QueryBuilder = {
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
      then<TResult1 = QueryResult, TResult2 = never>(
        onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ): PromiseLike<TResult1 | TResult2> {
        return Promise.resolve(result()).then(onfulfilled ?? undefined, onrejected ?? undefined);
      },
    };

    return query;
  });

  getSupabaseAdminMock.mockReturnValue({ from });
}

function expectNoTripRecordsRead() {
  const supabase = getSupabaseAdminMock.mock.results[0]?.value as
    | { from: ReturnType<typeof vi.fn> }
    | undefined;
  expect(supabase).toBeDefined();
  expect(supabase?.from).not.toHaveBeenCalledWith("delivery_trips");
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
  getSupabaseAdminMock.mockClear();
  mockSupabaseDirectory();
  sendOpsReplyMock.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  const restore = (key: string, value: string | undefined) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };
  restore("DOCUMENT_AUTOMATION_ENABLED", originalEnv.enabled);
  restore("GROQ_API_KEY", originalEnv.key);
  restore("GROQ_MODEL", originalEnv.model);
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
    expectNoTripRecordsRead();
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
    expectNoTripRecordsRead();
  });

  it("rejects a partial name when it could collide with a longer driver name", async () => {
    mockGroqIntent("driver_trip_summary", "Majeed");

    await handleFastWhatsAppQuery(
      inbound("Majeed P innale ethra trip poyi?"),
      "synthetic-inbound-id",
    );

    expect(sendOpsReplyMock).toHaveBeenCalledTimes(1);
    expect(sendOpsReplyMock.mock.calls[0][0].body).toContain("Driver directory");
    expect(sendOpsReplyMock.mock.calls[0][0].body).not.toContain("completed trips (ആകെ");
    expectNoTripRecordsRead();
  });
});
