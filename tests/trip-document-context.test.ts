import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  activeTrip: null as Record<string, unknown> | null,
  tripReadError: null as { message: string } | null,
  insertError: null as { code?: string; message: string } | null,
  existingTripId: "trip-current" as string | null,
  reservationReadError: null as { message: string } | null,
  from: vi.fn(),
  insert: vi.fn(),
  insertedRows: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/supabase-admin", () => ({
  getSupabaseAdmin: () => ({ from: state.from }),
}));

import { reserveTripDocument } from "../lib/trips";

const collectingTrip = {
  id: "trip-current",
  sender_phone: "919999999999",
  status: "collecting",
  display_name: "Kozhikode",
  primary_destination: "Kozhikode",
  destination_pincode: null,
  destination_district: null,
  destination_state: null,
  vehicle_number: null,
  driver_id: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  state.activeTrip = { ...collectingTrip };
  state.tripReadError = null;
  state.insertError = null;
  state.existingTripId = "trip-current";
  state.reservationReadError = null;
  state.insertedRows = [];
  state.insert.mockImplementation((row: Record<string, unknown>) => {
    state.insertedRows.push(row);
    return Promise.resolve({ error: state.insertError });
  });
  state.from.mockImplementation((table: string) => {
    if (table === "trip_documents") {
      const builder: Record<string, unknown> = {};
      builder.insert = state.insert;
      builder.select = () => builder;
      builder.eq = () => builder;
      builder.maybeSingle = async () => ({
        data: state.existingTripId ? { trip_id: state.existingTripId } : null,
        error: state.reservationReadError,
      });
      return builder;
    }

    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.eq = () => builder;
    builder.in = () => builder;
    builder.order = () => builder;
    builder.limit = () => builder;
    builder.maybeSingle = async () => ({
      data: state.activeTrip,
      error: state.tripReadError,
    });
    return builder;
  });
});

describe("bill-to-trip conversation context", () => {
  it("attaches a bill to the sender's currently collecting trip", async () => {
    await expect(
      reserveTripDocument({
        senderPhone: "919999999999",
        messageId: "bill-message-1",
      }),
    ).resolves.toBe("trip-current");

    expect(state.insertedRows).toEqual([
      {
        trip_id: "trip-current",
        message_id: "bill-message-1",
        processing_status: "pending",
      },
    ]);
  });

  it.each(["awaiting_driver", "awaiting_driver_name", "closing"])(
    "does not attach a new bill once the trip is %s",
    async (status) => {
      state.activeTrip = { ...collectingTrip, status };

      await expect(
        reserveTripDocument({
          senderPhone: "919999999999",
          messageId: "bill-message-2",
        }),
      ).resolves.toBeNull();

      expect(state.insert).not.toHaveBeenCalled();
    },
  );

  it("does not create a trip just because a bill arrived without an active collecting trip", async () => {
    state.activeTrip = null;

    await expect(
      reserveTripDocument({
        senderPhone: "919999999999",
        messageId: "bill-message-without-trip",
      }),
    ).resolves.toBeNull();

    expect(state.from).toHaveBeenCalledTimes(1);
    expect(state.insert).not.toHaveBeenCalled();
  });

  it("treats a duplicate bill reservation as idempotent", async () => {
    state.insertError = {
      code: "23505",
      message: "duplicate trip document",
    };

    await expect(
      reserveTripDocument({
        senderPhone: "919999999999",
        messageId: "bill-message-duplicate",
      }),
    ).resolves.toBe("trip-current");

    expect(state.insertedRows).toHaveLength(1);
  });

  it("does not claim a replayed bill belongs to a different active trip", async () => {
    state.insertError = {
      code: "23505",
      message: "trip_documents_message_once_idx",
    };
    state.existingTripId = "trip-previous";

    await expect(
      reserveTripDocument({
        senderPhone: "919999999999",
        messageId: "bill-message-from-previous-trip",
      }),
    ).resolves.toBeNull();
  });

  it("fails closed when duplicate reservation ownership cannot be verified", async () => {
    state.insertError = {
      code: "23505",
      message: "trip_documents_message_once_idx",
    };
    state.reservationReadError = { message: "synthetic reservation read failure" };

    await expect(
      reserveTripDocument({
        senderPhone: "919999999999",
        messageId: "bill-message-ownership-unknown",
      }),
    ).rejects.toThrow("Failed to verify trip document reservation");
  });

  it("fails visibly when reservation fails for a reason other than a duplicate", async () => {
    state.insertError = {
      code: "XX000",
      message: "synthetic database failure",
    };

    await expect(
      reserveTripDocument({
        senderPhone: "919999999999",
        messageId: "bill-message-failure",
      }),
    ).rejects.toThrow("Failed to reserve trip document");
  });

  it("does not silently continue when the active-trip lookup fails", async () => {
    state.tripReadError = { message: "synthetic read failure" };

    await expect(
      reserveTripDocument({
        senderPhone: "919999999999",
        messageId: "bill-message-read-failure",
      }),
    ).rejects.toThrow("Failed to load active trip");

    expect(state.insert).not.toHaveBeenCalled();
  });
});
