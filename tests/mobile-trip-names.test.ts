import { describe, expect, it } from "vitest";
import { mobileTripDisplayName } from "../lib/mobile-trips";
describe("operator trip labels", () => {
  for (const name of ["Mobile – Kerala run", "Trip: 123456", "എംവി - തിരൂർ"]) {
    it("preserves operator label " + name, () => {
      expect(
        mobileTripDisplayName({
          custom_name: name,
          display_name: "Automatic destination",
          entry_mode: "bills",
        }),
      ).toBe(name);
    });
  }
  it("preserves manually entered place labels", () => {
    expect(
      mobileTripDisplayName({
        custom_name: null,
        display_name: "Kerala",
        entry_mode: "manual",
      }),
    ).toBe("Kerala");
  });
  it("still cleans automatically extracted bill destinations", () => {
    expect(
      mobileTripDisplayName({
        custom_name: null,
        display_name: "tirur kerala",
        entry_mode: "bills",
      }),
    ).toBe("Tirur");
  });
});
