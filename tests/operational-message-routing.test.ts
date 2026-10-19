import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NormalizedWhatsAppMessage } from "../lib/whatsapp";

const state = vi.hoisted(() => ({
  calls: [] as string[],
  driver: vi.fn(),
  stock: vi.fn(),
  trip: vi.fn(),
  document: vi.fn(),
}));

vi.mock("@/lib/driver-agent", () => ({
  handleDriverMutation: state.driver,
}));
vi.mock("@/lib/stock-workflow", () => ({
  handleStockWorkflowInbound: state.stock,
}));
vi.mock("@/lib/trips", () => ({
  handleTripWorkflowInbound: state.trip,
}));
vi.mock("@/lib/document-automation", () => ({
  handleDocumentWorkflowInbound: state.document,
}));

import { routeOperationalTextMessage } from "../lib/operational-message-routing";

const message = {
  type: "text",
  messageId: "incoming-message",
  senderPhone: "919999999999",
  timestamp: new Date("2026-10-19T06:00:00.000Z"),
  textBody: "Rasheed innale ethra trip poyi?",
} as unknown as NormalizedWhatsAppMessage;

beforeEach(() => {
  vi.clearAllMocks();
  state.calls = [];
  state.driver.mockImplementation(async () => {
    state.calls.push("driver");
    return "ignored";
  });
  state.stock.mockImplementation(async () => {
    state.calls.push("stock");
    return "ignored";
  });
  state.trip.mockImplementation(async () => {
    state.calls.push("trip");
    return "ignored";
  });
  state.document.mockImplementation(async () => {
    state.calls.push("document");
    return "handled";
  });
});

describe("shared operational text routing", () => {
  it("stops after the first handler that recognizes the message", async () => {
    state.driver.mockImplementation(async () => {
      state.calls.push("driver");
      return "handled";
    });

    await expect(
      routeOperationalTextMessage(message, "stored-message"),
    ).resolves.toBe("handled");

    expect(state.calls).toEqual(["driver"]);
    expect(state.stock).not.toHaveBeenCalled();
    expect(state.trip).not.toHaveBeenCalled();
    expect(state.document).not.toHaveBeenCalled();
  });

  it("runs each handler once and prevents nested stock/trip redispatch", async () => {
    await expect(
      routeOperationalTextMessage(message, "stored-message"),
    ).resolves.toBe("handled");

    expect(state.calls).toEqual(["driver", "stock", "trip", "document"]);
    expect(state.document).toHaveBeenCalledWith(
      message,
      "stored-message",
      { skipOperationalWorkflows: true },
    );
  });

  it("preserves voice context while using the same handler sequence", async () => {
    await expect(
      routeOperationalTextMessage(message, "stored-message", {
        fromVoice: true,
      }),
    ).resolves.toBe("handled");

    expect(state.calls).toEqual(["driver", "stock", "trip", "document"]);
    expect(state.document).toHaveBeenCalledWith(
      message,
      "stored-message",
      { fromVoice: true, skipOperationalWorkflows: true },
    );
  });
});
