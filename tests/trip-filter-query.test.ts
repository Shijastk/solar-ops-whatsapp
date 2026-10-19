import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NormalizedWhatsAppMessage } from "@/lib/whatsapp";

const state = vi.hoisted(() => ({
  from: vi.fn(),
  sendOpsReply: vi.fn(),
  trips: [] as Array<Record<string, unknown>>,
  drivers: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/supabase-admin", () => ({
  getSupabaseAdmin: () => ({ from: state.from }),
}));
vi.mock("@/lib/replies", () => ({
  sendOpsReply: state.sendOpsReply,
}));
vi.mock("@/lib/whatsapp-query-intent", () => ({
  classifyOperationalQueryWithGroq: vi.fn().mockResolvedValue(null),
  looksLikeOperationalQuery: vi.fn().mockReturnValue(true),
}));

import { handleFastWhatsAppQuery } from "@/lib/whatsapp-queries";

function makeMessage(textBody: string): NormalizedWhatsAppMessage {
  return {
    type: "text",
    messageId: "trip-filter-query",
    senderPhone: "synthetic-sender",
    timestamp: new Date(),
    textBody,
  } as NormalizedWhatsAppMessage;
}

function makeQuery(table: string) {
  const filters: Array<{ kind: string; column: string; value: unknown }> = [];
  const builder: Record<string, unknown> = {};
  builder.select = () => builder;
  builder.eq = (column: string, value: unknown) => {
    filters.push({ kind: "eq", column, value });
    return builder;
  };
  builder.in = (column: string, value: unknown[]) => {
    filters.push({ kind: "in", column, value });
    return builder;
  };
  builder.ilike = (column: string, value: string) => {
    filters.push({ kind: "ilike", column, value });
    return builder;
  };
  builder.gte = (column: string, value: string) => {
    filters.push({ kind: "gte", column, value });
    return builder;
  };
  builder.lt = (column: string, value: string) => {
    filters.push({ kind: "lt", column, value });
    return builder;
  };
  builder.order = () => builder;
  builder.limit = () => builder;
  builder.then = (
    resolve: (value: unknown) => unknown,
    reject: (reason?: unknown) => unknown,
  ) => {
    let rows = table === "delivery_trips" ? state.trips : state.drivers;
    for (const filter of filters) {
      rows = rows.filter((row) => {
        const actual = row[filter.column];
        if (filter.kind === "eq") return actual === filter.value;
        if (filter.kind === "in") return (filter.value as unknown[]).includes(actual);
        if (filter.kind === "ilike") return String(actual ?? "").toLowerCase() === String(filter.value).toLowerCase();
        if (filter.kind === "gte") return String(actual ?? "") >= String(filter.value);
        if (filter.kind === "lt") return String(actual ?? "") < String(filter.value);
        return true;
      });
    }
    return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
  };
  return builder;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.sendOpsReply.mockResolvedValue(undefined);
  state.trips = [{
    id: "trip-1",
    status: "ready",
    display_name: "Tirur · Malappuram",
    primary_destination: "Tirur",
    vehicle_number: "KL 11 AA 1234",
    driver_id: "driver-1",
    finalized_at: new Date().toISOString(),
  }];
  state.drivers = [{ id: "driver-1", name: "Rasheed" }];
  state.from.mockImplementation((table: string) => makeQuery(table));
});

describe("trip summary filters", () => {
  it("returns only trips matching the normalized vehicle number", async () => {
    await expect(
      handleFastWhatsAppQuery(makeMessage("KL11AA1234 trips today"), "stored-vehicle-query"),
    ).resolves.toBe("handled");

    const reply = state.sendOpsReply.mock.calls[0][0].body as string;
    expect(reply).toContain("vehicle KL11AA1234 trips");
    expect(reply).toContain("Tirur · Malappuram");
    expect(reply).toContain("KL 11 AA 1234");
    expect(reply).toContain("Rasheed");
  });

  it("uses the previous India-day window for yesterday vehicle queries", async () => {
    state.trips[0].finalized_at = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    await expect(
      handleFastWhatsAppQuery(makeMessage("KL11AA1234 trips yesterday"), "stored-yesterday-vehicle-query"),
    ).resolves.toBe("handled");

    const reply = state.sendOpsReply.mock.calls[0][0].body as string;
    expect(reply).toContain("ഇന്നലെ vehicle KL11AA1234 trips");
    expect(reply).toContain("ആകെ 1");
    expect(reply).toContain("Tirur · Malappuram");
  });

  it("filters by an exact case-insensitive primary destination", async () => {
    await expect(
      handleFastWhatsAppQuery(makeMessage("How many trips to Tirur today"), "stored-destination-query"),
    ).resolves.toBe("handled");

    const reply = state.sendOpsReply.mock.calls[0][0].body as string;
    expect(reply).toContain("destination tirur trips");
    expect(reply).toContain("Tirur · Malappuram");
    expect(reply).toContain("KL 11 AA 1234");
  });

  it("does not report a match when the vehicle or destination is different", async () => {
    state.trips = [{
      id: "trip-2",
      status: "ready",
      display_name: "Kottakkal",
      primary_destination: "Kottakkal",
      vehicle_number: "KL 55 AF 7615",
      driver_id: "driver-1",
      finalized_at: new Date().toISOString(),
    }];

    await handleFastWhatsAppQuery(makeMessage("KL11AA1234 trips today"), "stored-vehicle-miss");
    expect(state.sendOpsReply.mock.calls[0][0].body).toContain("ആകെ 0");

    state.sendOpsReply.mockClear();
    await handleFastWhatsAppQuery(makeMessage("show trips to Tirur today"), "stored-destination-miss");
    expect(state.sendOpsReply.mock.calls[0][0].body).toContain("ആകെ 0");
  });
});
