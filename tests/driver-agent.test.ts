import { describe, expect, it } from "vitest";
import { normalizeDriverName, parseDriverMutation } from "@/lib/driver-agent";

describe("driver mutation intent parser", () => {
  it("parses explicit driver-list requests", () => {
    expect(parseDriverMutation("List drivers")).toEqual({ action: "list" });
    expect(parseDriverMutation("Show all drivers")).toEqual({ action: "list" });
    expect(parseDriverMutation("driver list kaanikku")).toEqual({ action: "list" });
  });

  it("parses explicit English create requests", () => {
    expect(parseDriverMutation("Add new driver named Mohammed")).toEqual({
      action: "create",
      name: "Mohammed",
    });
  });

  it("parses English create variants and trims punctuation", () => {
    expect(parseDriverMutation("Please register driver Rasheed.")).toEqual({
      action: "create",
      name: "Rasheed",
    });
    expect(parseDriverMutation("Add Rasheed as a new driver")).toEqual({
      action: "create",
      name: "Rasheed",
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
    expect(parseDriverMutation("Remove Rasheed from driver list")).toEqual({
      action: "deactivate",
      name: "Rasheed",
    });
  });

  it("does not treat ordinary mentions or questions as mutations", () => {
    expect(parseDriverMutation("Rasheed driver aanu")).toBeNull();
    expect(parseDriverMutation("Mohammed is a new driver")).toBeNull();
    expect(parseDriverMutation("What do you know about Mohammed?")).toBeNull();
    expect(parseDriverMutation("Please tell me about driver Rasheed")).toBeNull();
  });

  it("rejects incomplete create/delete commands", () => {
    expect(parseDriverMutation("Add new driver")).toBeNull();
    expect(parseDriverMutation("Add new driver named")).toBeNull();
    expect(parseDriverMutation("Delete driver")).toBeNull();
    expect(parseDriverMutation("Remove driver")).toBeNull();
  });

  it("normalizes Unicode and whitespace consistently", () => {
    expect(normalizeDriverName("  Mohammed   Ali  ")).toBe("Mohammed Ali");
  });
});
