import { describe, expect, it } from "vitest";
import { schema } from "../app/api/mobile/v1/operations/route";
import { validProfilePhoto } from "../lib/mobile-profile";
const id = "11111111-1111-4111-8111-111111111111";
describe("minimal mobile profiles and trip lifecycle", () => {
  it("requires an explicit action and rejects oversized names", () => {
    const b = {
      action: "trip_action",
      tripId: id,
      requestId: id,
      operation: "complete",
    };
    expect(schema.safeParse(b).success).toBe(true);
    expect(schema.safeParse({ ...b, operation: "refund_stock" }).success).toBe(
      false,
    );
    expect(
      schema.safeParse({ ...b, operation: "rename", name: "x".repeat(161) })
        .success,
    ).toBe(false);
  });
  it("accepts a bounded PNG photo and rejects arbitrary bytes or large dimensions", () => {
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=";
    expect(validProfilePhoto(png)).toBe(true);
    expect(
      validProfilePhoto(Buffer.from("not a photo").toString("base64")),
    ).toBe(false);
    const huge = Buffer.from(png, "base64");
    huge.writeUInt32BE(10000, 16);
    expect(validProfilePhoto(huge.toString("base64"))).toBe(false);
    expect(validProfilePhoto(png + "extra")).toBe(false);
  });
  it("does not allow a profile-only request to change company identity or add stock", () => {
    expect(
      schema.safeParse({
        action: "company_profile",
        companyId: id,
        gstin: "anything",
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        action: "company_profile",
        companyId: id,
        photo: null,
      }).success,
    ).toBe(true);
  });
});
