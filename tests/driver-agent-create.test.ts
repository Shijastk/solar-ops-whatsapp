import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  sendReply: vi.fn(),
  existing: null as { id: string; name: string; active: boolean } | null,
  created: null as { id: string; name: string; active: boolean } | null,
  verified: null as { id: string; name: string; active: boolean } | null,
  lookupError: null as { message: string } | null,
  insertError: null as { message: string; code?: string } | null,
  verifyError: null as { message: string } | null,
  insertPayload: null as { name: string; normalized_name: string; active: boolean } | null,
  listRows: [] as Array<{ name: string; active: boolean }>,
  driverMatches: [] as Array<{ id: string; name: string; active: boolean }>,
  listError: null as { message: string } | null,
  confirmationInsertError: null as { message: string } | null,
  confirmationPayload: null as { token_hash: string; sender_phone: string; driver_id: string; action: string; expires_at: string } | null,
  rpcResult: null as { data: { status: string; driver_name?: string } | null; error: { message: string } | null } | null,
  maybeSingleCount: 0,
  originalFeatureFlag: undefined as string | undefined,
}));

vi.mock("@/lib/supabase-admin", () => ({
  getSupabaseAdmin: () => ({ from: state.from, rpc: state.rpc }),
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
  state.listRows = [];
  state.driverMatches = [];
  state.listError = null;
  state.confirmationInsertError = null;
  state.confirmationPayload = null;
  state.rpcResult = { data: { status: "deactivated", driver_name: "Mohammed Ali" }, error: null };
  state.maybeSingleCount = 0;
  state.originalFeatureFlag = process.env.SOLAR_OPS_DRIVER_AGENT_ENABLED;
  process.env.SOLAR_OPS_DRIVER_AGENT_ENABLED = "true";

  state.rpc.mockImplementation(async (name: string) => {
    if (name !== "confirm_ops_driver_deactivation") throw new Error("Unexpected RPC: " + name);
    return state.rpcResult;
  });
  state.from.mockImplementation((table: string) => {
    if (table !== "ops_drivers" && table !== "ops_driver_action_confirmations") throw new Error("Unexpected table: " + table);
    const filters: Array<[string, unknown]> = [];
    const query: {
      select: ReturnType<typeof vi.fn>;
      eq: ReturnType<typeof vi.fn>;
      maybeSingle: ReturnType<typeof vi.fn>;
      insert: ReturnType<typeof vi.fn>;
      single: ReturnType<typeof vi.fn>;
      order: ReturnType<typeof vi.fn>;
      limit: ReturnType<typeof vi.fn>;
      then: ReturnType<typeof vi.fn>;
      filters: Array<[string, unknown]>;
    } = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn(),
      insert: vi.fn(),
      single: vi.fn(),
      order: vi.fn(),
      limit: vi.fn(),
      then: vi.fn(),
      filters,
    };
    query.select.mockReturnValue(query);
    query.eq.mockImplementation((column: string, value: unknown) => {
      filters.push([column, value]);
      return query;
    });
    query.order.mockReturnValue(query);
    query.limit.mockReturnValue(query);
    query.then.mockImplementation((resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
      const value = table === "ops_driver_action_confirmations"
        ? { data: null, error: state.confirmationInsertError }
        : filters.some(([column]) => column === "normalized_name")
          ? { data: state.driverMatches, error: state.listError }
          : { data: state.listRows, error: state.listError };
      return Promise.resolve(value).then(resolve, reject);
    });
    query.insert.mockImplementation((payload: typeof state.insertPayload) => {
      if (table === "ops_driver_action_confirmations") {
        state.confirmationPayload = payload as unknown as typeof state.confirmationPayload;
      } else {
        state.insertPayload = payload;
      }
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
  if (state.originalFeatureFlag === undefined) delete process.env.SOLAR_OPS_DRIVER_AGENT_ENABLED;
  else process.env.SOLAR_OPS_DRIVER_AGENT_ENABLED = state.originalFeatureFlag;
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

  it("does not claim success when the verification query returns a database error", async () => {
    state.verifyError = { message: "simulated verification failure" };

    await expect(
      handleDriverMutation(makeMessage("Add new driver named Mohammed Ali"), "stored-create-verify-query-error"),
    ).rejects.toThrow("Driver creation could not be verified");
    expect(state.sendReply).not.toHaveBeenCalled();
  });

  it("handles a concurrent duplicate insert only after verifying the active saved record", async () => {
    state.insertError = { message: "duplicate key", code: "23505" };
    state.verified = { id: "driver-existing", name: "Mohammed Ali", active: true };

    const result = await handleDriverMutation(
      makeMessage("Add new driver named Mohammed Ali"),
      "stored-create-race",
    );

    expect(result).toBe("handled");
    expect(state.from).toHaveBeenCalledTimes(3);
    expect(state.sendReply).toHaveBeenCalledTimes(1);
    expect(state.sendReply.mock.calls[0][0].body).toContain("Duplicate ചേർത്തിട്ടില്ല");
  });


  it("lists active drivers with a bounded query and stable ordering", async () => {
    state.listRows = Array.from({ length: 51 }, (_, index) => ({
      name: "Driver " + String(index + 1).padStart(2, "0"),
      active: true,
    }));

    const result = await handleDriverMutation(
      makeMessage("List drivers"),
      "stored-driver-list",
    );

    expect(result).toBe("handled");
    expect(state.from).toHaveBeenCalledTimes(1);
    expect(state.sendReply).toHaveBeenCalledTimes(1);
    const body = state.sendReply.mock.calls[0][0].body as string;
    expect(body).toContain("first 50; more exist");
    expect(body).toContain("50. Driver 50");
    expect(body).not.toContain("51. Driver 51");
  });

  it("replies clearly when there are no active drivers", async () => {
    state.listRows = [];

    const result = await handleDriverMutation(
      makeMessage("Show all drivers"),
      "stored-driver-list-empty",
    );

    expect(result).toBe("handled");
    expect(state.sendReply.mock.calls[0][0].body).toContain("active drivers ഒന്നുമില്ല");
  });

  it("does not send a misleading list when the database query fails", async () => {
    state.listError = { message: "simulated list failure" };

    await expect(
      handleDriverMutation(makeMessage("List drivers"), "stored-driver-list-error"),
    ).rejects.toThrow("Driver list lookup failed");
    expect(state.sendReply).not.toHaveBeenCalled();
  });


  it("creates a sender-scoped one-time confirmation for driver deactivation", async () => {
    state.driverMatches = [{ id: "driver-1", name: "Mohammed Ali", active: true }];

    const result = await handleDriverMutation(
      makeMessage("Delete driver named Mohammed Ali"),
      "stored-deactivate-request",
    );

    expect(result).toBe("handled");
    expect(state.from).toHaveBeenCalledWith("ops_driver_action_confirmations");
    expect(state.sendReply).toHaveBeenCalledTimes(1);
    const body = state.sendReply.mock.calls[0][0].body as string;
    expect(body).toContain("CONFIRM DRIVER ");
    expect(body).toContain("5 മിനിറ്റിനുള്ളിൽ");
    expect(state.confirmationPayload).not.toBeNull();
    expect(state.confirmationPayload?.token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(state.confirmationPayload?.sender_phone).toBe("15550001111");
    expect(state.confirmationPayload?.driver_id).toBe("driver-1");
    expect(state.confirmationPayload?.action).toBe("deactivate");
    expect(body).not.toContain(state.confirmationPayload?.token_hash ?? "never-match");
  });

  it("fails closed when the durable confirmation cannot be stored", async () => {
    state.driverMatches = [{ id: "driver-1", name: "Mohammed Ali", active: true }];
    state.confirmationInsertError = { message: "simulated insert error" };

    await expect(
      handleDriverMutation(makeMessage("Delete driver named Mohammed Ali"), "stored-deactivate-insert-error"),
    ).rejects.toThrow("Driver deactivation confirmation could not be created");
    expect(state.sendReply).not.toHaveBeenCalled();
  });

  it("sends the token hash and sender identity to the atomic confirmation RPC", async () => {
    const token = "a".repeat(48);
    const result = await handleDriverMutation(
      makeMessage("CONFIRM DRIVER " + token),
      "stored-deactivate-confirm",
    );

    expect(result).toBe("handled");
    expect(state.rpc).toHaveBeenCalledWith("confirm_ops_driver_deactivation", {
      p_token_hash: expect.any(String),
      p_sender_phone: "15550001111",
    });
    expect(state.sendReply.mock.calls[0][0].body).toContain("deactivate ചെയ്തു");
  });

  it("does not claim deactivation success for an invalid or expired token", async () => {
    state.rpcResult = { data: { status: "invalid" }, error: null };

    const result = await handleDriverMutation(
      makeMessage("CONFIRM DRIVER " + "b".repeat(48)),
      "stored-deactivate-invalid",
    );

    expect(result).toBe("handled");
    expect(state.sendReply.mock.calls[0][0].body).toContain("മാറ്റമൊന്നും വരുത്തിയിട്ടില്ല");
    expect(state.sendReply.mock.calls[0][0].body).not.toContain("deactivate ചെയ്തു");
  });


  it("does not claim a confirmation result when the atomic RPC fails", async () => {
    state.rpcResult = { data: null, error: { message: "simulated rpc failure" } };

    await expect(
      handleDriverMutation(makeMessage("CONFIRM DRIVER " + "c".repeat(48)), "stored-deactivate-rpc-error"),
    ).rejects.toThrow("Driver deactivation confirmation failed");
    expect(state.sendReply).not.toHaveBeenCalled();
  });

});
