import { describe, expect, it } from "vitest";
import { normalizeDriverName, parseDriverMutation } from "@/lib/driver-agent";

describe("driver mutation intent parser", () => {
  it("parses explicit English create requests", () => {
    expect(parseDriverMutation("Add new driver named Mohammed")).toEqual({
      action: "create",
      name: "Mohammed",
    });
  });

  it("parses Malayalam create requests", () => {
    expect(parseDriverMutation("മുഹമ്മദിനെ പുതിയ ഡ്രൈവറായി ആഡ് ചെയ്യണം")).toEqual({
      action: "create",
      name: "മുഹമ്മദ്",
    });
  });

  it("parses Manglish create requests", () => {
    expect(parseDriverMutation("Mohammed new driver ആയി add ചെയ്യണം")).toEqual({
      action: "create",
      name: "Mohammed",
    });
  });

  it("parses explicit delete requests as deactivation intent", () => {
    expect(parseDriverMutation("Delete driver named Mohammed")).toEqual({
      action: "deactivate",
      name: "Mohammed",
    });
  });

  it("does not mutate when a driver is merely mentioned", () => {
    expect(parseDriverMutation("Mohammed is a new driver")).toBeNull();
    expect(parseDriverMutation("What do you know about Mohammed?")).toBeNull();
  });

  it("normalizes Unicode and whitespace consistently", () => {
    expect(normalizeDriverName("  Mohammed   Ali  ")).toBe("Mohammed Ali");
  });
});
