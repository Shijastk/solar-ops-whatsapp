import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  drivers: [] as Array<{ name: string; active: boolean }>,
  from: vi.fn(),
  sendReply: vi.fn(),
  queryError: null as { message: string } | null,
  activeOnly: false,
}));

vi.mock("@/lib/supabase-admin", () => ({
  getSupabaseAdmin: () => ({ from: state.from }),
}));
vi.mock("@/lib/replies", () => ({
  sendOpsReply: state.sendReply,
}));

import { handleDriverMutation } from "@/lib/driver-agent";

function makeMessage(textBody: string) {
  return {
    type: "text",
    textBody,
    messageId: "wamid.test.driver.list.001",
    timestamp: new Date(),
    senderPhone: "15550001111",
  } as const;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.queryError = null;
  state.activeOnly = false;
  state.drivers = [
    { name: "Rasheed", active: true },
    { name: "Old Driver", active: false },
    { name: "Sameer", active: true },
  ];
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockImplementation((column: string, value: unknown) => { if (column === "active" && value === true) state.activeOnly = true; return chain; });
  chain.order.mockReturnValue(chain);
  chain.limit.mockImplementation(async () => ({
    data: state.queryError ? null : [...state.drivers].filter((driver) => !state.activeOnly || driver.active).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 51),
    error: state.queryError,
  }));
  state.from.mockReturnValue(chain);
  state.sendReply.mockResolvedValue(undefined);
});

describe("driver agent isolated read-only handler", () => {
  it("lists active drivers only and uses a bounded query", async () => {
    const originalFlag = process.env.SOLAR_OPS_DRIVER_AGENT_ENABLED;
    process.env.SOLAR_OPS_DRIVER_AGENT_ENABLED = "true";
    try {
      const result = await handleDriverMutation(makeMessage("List drivers"), "stored-inbound-1");
      expect(result).toBe("handled");
      expect(state.from).toHaveBeenCalledWith("ops_drivers");
      expect(state.sendReply).toHaveBeenCalledTimes(1);
      expect(state.sendReply.mock.calls[0][0].body).toContain("Rasheed");
      expect(state.sendReply.mock.calls[0][0].body).toContain("Sameer");
      expect(state.sendReply.mock.calls[0][0].body).not.toContain("Old Driver");
      expect(state.sendReply.mock.calls[0][0].body).toContain("Active drivers (2)");
    } finally {
      if (originalFlag === undefined) delete process.env.SOLAR_OPS_DRIVER_AGENT_ENABLED;
      else process.env.SOLAR_OPS_DRIVER_AGENT_ENABLED = originalFlag;
    }
  });

  it("does not query the database when the feature gate is disabled", async () => {
    const originalFlag = process.env.SOLAR_OPS_DRIVER_AGENT_ENABLED;
    delete process.env.SOLAR_OPS_DRIVER_AGENT_ENABLED;
    try {
      const result = await handleDriverMutation(makeMessage("List drivers"), "stored-inbound-2");
      expect(result).toBe("ignored");
      expect(state.from).not.toHaveBeenCalled();
      expect(state.sendReply).not.toHaveBeenCalled();
    } finally {
      if (originalFlag === undefined) delete process.env.SOLAR_OPS_DRIVER_AGENT_ENABLED;
      else process.env.SOLAR_OPS_DRIVER_AGENT_ENABLED = originalFlag;
    }
  });

  it("does not query or reply for an ambiguous message", async () => {
    const originalFlag = process.env.SOLAR_OPS_DRIVER_AGENT_ENABLED;
    process.env.SOLAR_OPS_DRIVER_AGENT_ENABLED = "true";
    try {
      const result = await handleDriverMutation(makeMessage("Rasheed driver aanu"), "stored-inbound-3");
      expect(result).toBe("ignored");
      expect(state.from).not.toHaveBeenCalled();
      expect(state.sendReply).not.toHaveBeenCalled();
    } finally {
      if (originalFlag === undefined) delete process.env.SOLAR_OPS_DRIVER_AGENT_ENABLED;
      else process.env.SOLAR_OPS_DRIVER_AGENT_ENABLED = originalFlag;
    }
  });
  it("replies clearly when there are no active drivers", async () => {
    const originalFlag = process.env.SOLAR_OPS_DRIVER_AGENT_ENABLED;
    process.env.SOLAR_OPS_DRIVER_AGENT_ENABLED = "true";
    state.drivers = [{ name: "Old Driver", active: false }];
    try {
      const result = await handleDriverMutation(makeMessage("List drivers"), "stored-inbound-empty");
      expect(result).toBe("handled");
      expect(state.sendReply.mock.calls[0][0].body).toContain("active drivers ഒന്നുമില്ല");
    } finally {
      if (originalFlag === undefined) delete process.env.SOLAR_OPS_DRIVER_AGENT_ENABLED;
      else process.env.SOLAR_OPS_DRIVER_AGENT_ENABLED = originalFlag;
    }
  });

  it("fails closed and does not send a misleading reply on database errors", async () => {
    const originalFlag = process.env.SOLAR_OPS_DRIVER_AGENT_ENABLED;
    process.env.SOLAR_OPS_DRIVER_AGENT_ENABLED = "true";
    state.queryError = { message: "simulated database failure" };
    try {
      await expect(
        handleDriverMutation(makeMessage("List drivers"), "stored-inbound-error"),
      ).rejects.toThrow("Driver list lookup failed");
      expect(state.sendReply).not.toHaveBeenCalled();
    } finally {
      if (originalFlag === undefined) delete process.env.SOLAR_OPS_DRIVER_AGENT_ENABLED;
      else process.env.SOLAR_OPS_DRIVER_AGENT_ENABLED = originalFlag;
    }
  });

  it("marks the list as truncated rather than reporting a misleading total", async () => {
    const originalFlag = process.env.SOLAR_OPS_DRIVER_AGENT_ENABLED;
    process.env.SOLAR_OPS_DRIVER_AGENT_ENABLED = "true";
    state.drivers = Array.from({ length: 55 }, (_, index) => ({
      name: "Driver " + String(index + 1).padStart(2, "0"),
      active: true,
    }));
    try {
      await handleDriverMutation(makeMessage("List drivers"), "stored-inbound-truncated");
      const body = state.sendReply.mock.calls[0][0].body as string;
      expect(body).toContain("first 50; more exist");
      expect(body).toContain("50. Driver 50");
      expect(body).not.toContain("51. Driver 51");
    } finally {
      if (originalFlag === undefined) delete process.env.SOLAR_OPS_DRIVER_AGENT_ENABLED;
      else process.env.SOLAR_OPS_DRIVER_AGENT_ENABLED = originalFlag;
    }
  });

});
