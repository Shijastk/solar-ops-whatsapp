import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  from: vi.fn(),
  result: { data: { enabled: true } as { enabled: boolean } | null, error: null as { message: string } | null },
  updates: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/supabase-admin", () => ({
  getSupabaseAdmin: () => ({ from: state.from }),
}));

import { getAgentEnabled, setAgentEnabled } from "@/lib/agent-settings";

beforeEach(() => {
  vi.clearAllMocks();
  state.result = { data: { enabled: true }, error: null };
  state.updates = [];
  state.from.mockImplementation(() => {
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.eq = () => builder;
    builder.update = (value: Record<string, unknown>) => {
      state.updates.push(value);
      return builder;
    };
    builder.maybeSingle = async () => state.result;
    return builder;
  });
});

describe("central agent setting", () => {
  it("reads the singleton setting", async () => {
    await expect(getAgentEnabled()).resolves.toBe(true);
    expect(state.from).toHaveBeenCalledWith("ops_agent_settings");
  });

  it("fails closed when the setting is missing or unreadable", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    state.result = { data: null, error: null };
    await expect(getAgentEnabled()).resolves.toBe(false);

    state.result = { data: null, error: { message: "database unavailable" } };
    await expect(getAgentEnabled()).resolves.toBe(false);
    expect(error).toHaveBeenCalledTimes(2);
  });

  it("persists an explicit enabled or disabled value", async () => {
    state.result = { data: { enabled: false }, error: null };
    await expect(setAgentEnabled(false)).resolves.toBeUndefined();
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0]).toMatchObject({ enabled: false });
  });

  it("rejects a failed or mismatched update", async () => {
    state.result = { data: null, error: { message: "write failed" } };
    await expect(setAgentEnabled(true)).rejects.toThrow("could not be updated");
  });
});
