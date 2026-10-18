import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  from: vi.fn(),
  sendReply: vi.fn(),
  existing: null as { id: string; name: string; active: boolean } | null,
  created: { id: string; name: string; active: boolean } | null,
  verified: { id: string; name: string; active: boolean } | null,
  lookupError: null as { message: string } | null,
  insertError: null as { message: string; code?: string } | null,
  verifyError: null as { message: string } | null,
  insertPayload: null as { name: string; normalized_name: string; active: boolean } | null,
  maybeSingleCount: 0,
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
    messageId: "wamid.test.driver.create.001",
    timestamp: new Date(),
    senderPhone: "15550001111",
  } as const;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.existing = null;
  state.created = { id: "driver-1", name: "Mohammed Ali", active: true };
  state.verified = { id: "driver-1", name: "Mohammed Ali", active: true };
  state.lookupError = null;
  state.insertError = null;
  state.verifyError = null;
  state.insertPayload = null;
  state.maybeSingleCount = 0;
  process.env.SOLAR_OPS_DRIVER_AGENT_ENABLED = "true";

  state.from.mockImplementation((table: string) => {
    if (table !== "ops_drivers") throw new Error("Unexpected table: " + table);
    const query: {
      select: ReturnType<typeof vi.fn>;
      eq: ReturnType<typeof vi.fn>;
      maybeSingle: ReturnType<typeof vi.fn>;
      insert: ReturnType<typeof vi.fn>;
      single: ReturnType<typeof vi.fn>;
    } = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn(),
      insert: vi.fn(),
      single: vi.fn(),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.insert.mockImplementation((payload: typeof state.insertPayload) => {
      state.insertPayload = payload;
      return query;
    });
    query.maybeSingle.mockImplementation(async () => {
      state.maybeSingleCount += 1;
      if (state.maybeSingleCount === 1) {
        return { data: state.existing, error: state.lookupError };
      }
      return { data: state.verified, error: state.verifyError };
    });
    query.single.mockImplementation(async () => ({
      data: state.created,
      error: state.insertError,
    }));
    return query;
  });
  state.sendReply.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  delete process.env.SOLAR_OPS_DRIVER_AGENT_ENABLED;
});

describe("driver agent isolated create handler", () => {
  it("inserts a normalized active driver and verifies the saved row before replying", async () => {
    const result = await handleDriverMutation(
      makeMessage("Add new driver named Mohammed Ali"),
      "stored-create-success",
    );

    expect(result).toBe("handled");
    expect(state.from).toHaveBeenCalledTimes(3);
    expect(state.insertPayload).toEqual({
      name: "Mohammed Ali",
      normalized_name: "mohammed ali",
      active: true,
    });
    expect(state.sendReply).toHaveBeenCalledTimes(1);
    expect(state.sendReply.mock.calls[0][0].body).toContain("Mohammed Ali");
  });

  it("does not insert a duplicate active driver", async () => {
    state.existing = { id: "driver-existing", name: "Mohammed Ali", active: true };

    const result = await handleDriverMutation(
      makeMessage("Add new driver named Mohammed Ali"),
      "stored-create-duplicate",
    );

    expect(result).toBe("handled");
    expect(state.from).toHaveBeenCalledTimes(1);
    expect(state.insertPayload).toBeNull();
    expect(state.sendReply).toHaveBeenCalledTimes(1);
    expect(state.sendReply.mock.calls[0][0].body).toContain("നിലവിലുണ്ട്");
  });

  it("fails closed when the initial duplicate lookup fails", async () => {
    state.lookupError = { message: "simulated lookup failure" };

    await expect(
      handleDriverMutation(makeMessage("Add new driver named Mohammed Ali"), "stored-create-lookup-error"),
    ).rejects.toThrow("Driver lookup failed");
    expect(state.insertPayload).toBeNull();
    expect(state.sendReply).not.toHaveBeenCalled();
  });

  it("fails closed when insert fails", async () => {
    state.insertError = { message: "simulated insert failure" };

    await expect(
      handleDriverMutation(makeMessage("Add new driver named Mohammed Ali"), "stored-create-insert-error"),
    ).rejects.toThrow("Driver creation failed");
    expect(state.sendReply).not.toHaveBeenCalled();
  });

  it("does not claim success when read-after-write verification fails", async () => {
    state.verified = null;

    await expect(
      handleDriverMutation(makeMessage("Add new driver named Mohammed Ali"), "stored-create-verify-error"),
    ).rejects.toThrow("Driver creation could not be verified");
    expect(state.sendReply).not.toHaveBeenCalled();
  });

  it("does not reactivate an existing inactive record without explicit confirmation", async () => {
    state.existing = { id: "driver-inactive", name: "Mohammed Ali", active: false };

    const result = await handleDriverMutation(
      makeMessage("Add new driver named Mohammed Ali"),
      "stored-create-inactive",
    );

    expect(result).toBe("handled");
    expect(state.insertPayload).toBeNull();
    expect(state.sendReply.mock.calls[0][0].body).toContain("വീണ്ടും active ആക്കണോ");
  });
});
