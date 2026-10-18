import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  from: vi.fn(),
  sendReply: vi.fn(),
  insertedTrips: [] as Array<Record<string, unknown>>,
  activeTrip: null as Record<string, unknown> | null,
  driverRows: [] as Array<{ id: string; name: string; normalized_name: string; active: boolean }>,
  duplicateInsert: false,
}));

vi.mock("@/lib/supabase-admin", () => ({
  getSupabaseAdmin: () => ({ from: state.from }),
}));

vi.mock("@/lib/replies", () => ({
  sendOpsList: vi.fn(),
  sendOpsReply: state.sendReply,
}));

import { handleTripWorkflowInbound } from "@/lib/trips";

function makeChain(table: string) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "order", "limit"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn(async () => ({
    data: state.activeTrip,
    error: null,
  }));
  chain.insert = vi.fn(async (row: Record<string, unknown>) => {
    state.insertedTrips.push(row);
    if (state.duplicateInsert) {
      state.activeTrip = {
        id: "active-trip",
        sender_phone: "15550001111",
        status: "collecting",
        display_name: null,
        primary_destination: null,
        destination_pincode: null,
        destination_district: null,
        destination_state: null,
        vehicle_number: null,
        driver_id: null,
      };
      return { error: { code: "23505", message: "duplicate active sender" } };
    }
    return { error: null };
  });
  chain.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve({
      data: table === "ops_drivers" ? state.driverRows : null,
      error: null,
    }).then(resolve, reject);
  return chain;
}

function mockIntent(intent: string, driverName: string | null = null) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                intent,
                product_query: null,
                driver_name: driverName,
                yesterday: false,
                period: null,
                reply: null,
              }),
            },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function makeMessage(textBody: string) {
  return {
    type: "text",
    textBody,
    messageId: "wamid.test.trip.start.001",
    timestamp: new Date("2026-10-18T12:00:00.000Z"),
    senderPhone: "15550001111",
  } as const;
}

const originalEnv = {
  enabled: process.env.DOCUMENT_AUTOMATION_ENABLED,
  key: process.env.GROQ_API_KEY,
  model: process.env.GROQ_MODEL,
  timeout: process.env.GROQ_TIMEOUT_MS,
  naturalTripStart: process.env.SOLAR_OPS_NATURAL_TRIP_START_ENABLED,
};

beforeEach(() => {
  vi.clearAllMocks();
  state.insertedTrips = [];
  state.activeTrip = null;
  state.driverRows = [];
  state.duplicateInsert = false;
  state.from.mockImplementation((table: string) => makeChain(table));
  state.sendReply.mockResolvedValue(undefined);
  process.env.DOCUMENT_AUTOMATION_ENABLED = "true";
  process.env.GROQ_API_KEY = "groq-test-secret";
  process.env.SOLAR_OPS_NATURAL_TRIP_START_ENABLED = "true";
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
  restore("GROQ_TIMEOUT_MS", originalEnv.timeout);
  restore("SOLAR_OPS_NATURAL_TRIP_START_ENABLED", originalEnv.naturalTripStart);
});

describe("natural-language trip start", () => {
  it("opens a trip only when the bounded classifier returns start_trip", async () => {
    const fetchMock = mockIntent("start_trip");
    const result = await handleTripWorkflowInbound(
      makeMessage("Please open a delivery trip"),
      "stored-trip-message-1",
    );

    expect(result).toBe("handled");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(state.insertedTrips).toHaveLength(1);
    expect(state.insertedTrips[0]).toMatchObject({
      sender_phone: "15550001111",
      status: "collecting",
      driver_id: null,
      started_by_message_id: "stored-trip-message-1",
    });
    expect(state.sendReply).toHaveBeenCalledTimes(1);
    expect(state.sendReply.mock.calls[0][0].body).toContain("New Trip തുറന്നു");
  });

  it("keeps natural-language trip creation disabled unless the rollout flag is true", async () => {
    delete process.env.SOLAR_OPS_NATURAL_TRIP_START_ENABLED;
    const fetchMock = mockIntent("start_trip");

    const result = await handleTripWorkflowInbound(
      makeMessage("Please open a delivery trip"),
      "stored-trip-message-flag-off",
    );

    expect(result).toBe("handled");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(state.insertedTrips).toHaveLength(0);
    expect(state.sendReply).toHaveBeenCalledTimes(1);
    expect(state.sendReply.mock.calls[0][0].body).toContain("enabled അല്ല");
  });

  it("assigns a named driver only after exact active-directory matching", async () => {
    mockIntent("start_trip", "Rasheed");
    state.driverRows = [
      { id: "driver-rasheed", name: "Rasheed", normalized_name: "rasheed", active: true },
    ];

    const result = await handleTripWorkflowInbound(
      makeMessage("Please open a new trip with Rasheed"),
      "stored-trip-message-2",
    );

    expect(result).toBe("handled");
    expect(state.from).toHaveBeenCalledWith("ops_drivers");
    expect(state.insertedTrips).toHaveLength(1);
    expect(state.insertedTrips[0]).toMatchObject({
      status: "collecting",
      driver_id: "driver-rasheed",
    });
  });

  it("does not create a trip when the requested driver is not an exact active match", async () => {
    mockIntent("start_trip", "Unknown Driver");

    const result = await handleTripWorkflowInbound(
      makeMessage("Please open a new trip with Unknown Driver"),
      "stored-trip-message-unknown-driver",
    );

    expect(result).toBe("handled");
    expect(state.from).toHaveBeenCalledWith("ops_drivers");
    expect(state.insertedTrips).toHaveLength(0);
    expect(state.sendReply).toHaveBeenCalledTimes(1);
    expect(state.sendReply.mock.calls[0][0].body).toContain("Trip create ചെയ്തിട്ടില്ല");
  });

  it("does not create a trip when the model classifies the message as a read query", async () => {
    mockIntent("latest_trip");

    const result = await handleTripWorkflowInbound(
      makeMessage("Please open a delivery trip"),
      "stored-trip-message-3",
    );

    expect(result).toBe("ignored");
    expect(state.insertedTrips).toHaveLength(0);
  });

  it("does not treat a trip question as a driver name while awaiting driver entry", async () => {
    state.activeTrip = {
      id: "active-trip",
      sender_phone: "15550001111",
      status: "awaiting_driver_name",
      display_name: null,
      primary_destination: null,
      destination_pincode: null,
      destination_district: null,
      destination_state: null,
      vehicle_number: null,
      driver_id: null,
    };

    const result = await handleTripWorkflowInbound(
      makeMessage("What is the latest trip?"),
      "stored-trip-message-question",
    );

    expect(result).toBe("ignored");
    expect(state.from).not.toHaveBeenCalledWith("ops_drivers");
    expect(state.insertedTrips).toHaveLength(0);
    expect(state.sendReply).not.toHaveBeenCalled();
  });

  it("handles a concurrent active-trip uniqueness conflict without creating a second trip", async () => {
    state.duplicateInsert = true;

    const result = await handleTripWorkflowInbound(
      makeMessage("trip"),
      "stored-trip-message-4",
    );

    expect(result).toBe("handled");
    expect(state.insertedTrips).toHaveLength(1);
    expect(state.sendReply).toHaveBeenCalledTimes(1);
    expect(state.sendReply.mock.calls[0][0].body).toContain("duplicate trip create ചെയ്തിട്ടില്ല");
  });
});
