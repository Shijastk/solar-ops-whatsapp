import { describe, expect, it } from "vitest";
import { schema } from "../app/api/mobile/v1/operations/route";
const uuid = "11111111-1111-4111-8111-111111111111";
const input = {
  action: "manual_dispatch",
  requestId: uuid,
  companyId: uuid,
  destination: "Synthetic place",
  driverId: uuid,
  items: [
    {
      productId: uuid,
      productName: "Synthetic panel",
      unit: "NOS",
      quantity: 7,
    },
  ],
};
describe("manual mobile dispatch boundary", () => {
  it("requires company, driver and positive quantities without requiring a bill or price", () => {
    expect(schema.safeParse(input).success).toBe(true);
    expect(schema.safeParse({ ...input, driverId: null }).success).toBe(false);
    expect(
      schema.safeParse({
        ...input,
        items: [{ ...input.items[0], quantity: 0 }],
      }).success,
    ).toBe(false);
  });
  it("defaults to one site and rejects empty place or unsafe decimal quantities", () => {
    expect(schema.parse(input)).toMatchObject({ siteCount: 1 });
    expect(schema.safeParse({ ...input, destination: " " }).success).toBe(
      false,
    );
    expect(
      schema.safeParse({
        ...input,
        items: [{ ...input.items[0], quantity: 1.0001 }],
      }).success,
    ).toBe(false);
  });
});
