import { describe, expect, it } from "vitest";
import { isWithinCustomerServiceWindow } from "../lib/replies";

describe("WhatsApp customer service window", () => {
  const now = new Date("2026-09-21T12:00:00.000Z");

  it("allows a reply inside the 24-hour window", () => {
    expect(
      isWithinCustomerServiceWindow(
        new Date("2026-09-20T12:00:01.000Z"),
        now,
      ),
    ).toBe(true);
  });

  it("blocks a reply after the 24-hour window", () => {
    expect(
      isWithinCustomerServiceWindow(
        new Date("2026-09-20T11:59:59.000Z"),
        now,
      ),
    ).toBe(false);
  });
});
