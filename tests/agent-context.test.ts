import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  from: vi.fn(),
  table: null as string | null,
  saved: null as Record<string, unknown> | null,
  row: null as Record<string, unknown> | null,
  readError: null as { message: string } | null,
  writeError: null as { message: string } | null,
  filters: [] as Array<[string, unknown]>,
}));

vi.mock("@/lib/supabase-admin", () => ({
  getSupabaseAdmin: () => ({ from: state.from }),
}));

import { loadAgentContext, saveAgentContext } from "@/lib/agent-context";

function makeChain() {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "upsert"]) {
    chain[method] = vi.fn((...args: unknown[]) => {
      if (method === "upsert") {
        state.saved = args[0] as Record<string, unknown>;
        return Promise.resolve({ error: state.writeError });
      }
      return chain;
    });
  }
  chain.eq = vi.fn((column: string, value: unknown) => {
    state.filters.push([column, value]);
    return chain;
  });
  chain.gt = vi.fn((column: string, value: unknown) => {
    state.filters.push([column, value]);
    return chain;
  });
  chain.maybeSingle = vi.fn(async () => ({
    data: state.row,
    error: state.readError,
  }));
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.table = null;
  state.saved = null;
  state.row = null;
  state.readError = null;
  state.writeError = null;
  state.filters = [];
  state.from.mockImplementation((table: string) => {
    state.table = table;
    return makeChain();
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("short-lived agent context", () => {
  it("stores only bounded structured context with a ten-minute expiry", async () => {
    await saveAgentContext({
      senderPhone: "15550001111",
      lastIntent: "driver_count",
    });

    expect(state.table).toBe("ops_agent_conversation_context");
    const saved = state.saved as Record<string, unknown>;
    expect(saved).toMatchObject({
      sender_phone: "15550001111",
      business_scope: "solar-ops",
      last_intent: "driver_count",
      last_entity_ids: [],
      last_entity_names: [],
      last_date_scope: null,
      company_scope: null,
    });
    expect(saved).not.toHaveProperty("textBody");
    expect(saved).not.toHaveProperty("messageText");
    expect(Date.parse(String(saved.expires_at)) - Date.parse(String(saved.updated_at))).toBe(
      10 * 60 * 1000,
    );
  });

  it("loads valid unexpired context for the exact sender and business scope", async () => {
    state.row = {
      last_intent: "driver_count",
      last_entity_ids: [],
      last_entity_names: [],
      last_date_scope: null,
      company_scope: null,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    };

    await expect(loadAgentContext("15550001111")).resolves.toMatchObject({
      lastIntent: "driver_count",
      entityIds: [],
      entityNames: [],
      companyScope: null,
    });
    expect(state.filters).toContainEqual(["sender_phone", "15550001111"]);
    expect(state.filters).toContainEqual(["business_scope", "solar-ops"]);
    expect(state.filters.some(([column]) => column === "expires_at")).toBe(true);
  });

  it("ignores expired or malformed context rather than trusting it", async () => {
    state.row = {
      last_intent: "driver_count",
      last_entity_ids: [],
      last_entity_names: [],
      last_date_scope: null,
      company_scope: null,
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    };
    await expect(loadAgentContext("15550001111")).resolves.toBeNull();

    state.row = {
      last_intent: "start_trip",
      last_entity_ids: [],
      last_entity_names: [],
      last_date_scope: null,
      company_scope: null,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    };
    await expect(loadAgentContext("15550001111")).resolves.toBeNull();
  });

  it("surfaces storage errors so callers can fail closed on context", async () => {
    state.readError = { message: "read failed" };
    await expect(loadAgentContext("15550001111")).rejects.toThrow(
      "Failed to load agent context",
    );

    state.readError = null;
    state.writeError = { message: "write failed" };
    await expect(
      saveAgentContext({ senderPhone: "15550001111", lastIntent: "driver_count" }),
    ).rejects.toThrow("Failed to save agent context");
  });
});
