import { describe, expect, it } from "vitest";
import {
  buildTripDisplayName,
  classifyTripTextCommand,
  normalizeDriverName,
  parseIndiaPostPincodeCsv,
} from "../lib/trips";

describe("WhatsApp trip capture helpers", () => {
  it("recognizes fast trip commands without AI", () => {
    expect(classifyTripTextCommand("trip")).toBe("start");
    expect(classifyTripTextCommand("New Trip")).toBe("start");
    expect(classifyTripTextCommand("ട്രിപ്പ്")).toBe("start");
    expect(classifyTripTextCommand("done")).toBe("done");
    expect(classifyTripTextCommand("ശരി")).toBe("done");
    expect(classifyTripTextCommand("complete")).toBe("done");
    expect(classifyTripTextCommand("cancel trip")).toBe("cancel");
    expect(classifyTripTextCommand("Emmvee 560 panel")).toBeNull();
  });

  it("uses destination as the human trip name instead of an opaque id", () => {
    expect(
      buildTripDisplayName({
        destination: "TIRUR",
        pincode: "676101",
        district: "Malappuram",
      }),
    ).toBe("Tirur · Malappuram");

    expect(
      buildTripDisplayName({
        destination: "Tirur",
        pincode: "676101",
        district: null,
        additionalStops: 2,
      }),
    ).toBe("Tirur + 2 stops");
  });

  it("falls back to pincode/district when destination is missing", () => {
    expect(
      buildTripDisplayName({
        destination: null,
        pincode: "676101",
        district: "Malappuram",
      }),
    ).toBe("Malappuram");

    expect(
      buildTripDisplayName({
        destination: null,
        pincode: "676101",
        district: null,
      }),
    ).toBe("PIN 676101");
  });

  it("parses India Post pincode CSV fields deterministically", () => {
    const csv = [
      "officename,pincode,officeType,Deliverystatus,divisionname,regionname,circlename,Taluk,Districtname,statename",
      "Tirur(kerala) H.O,676101,HO,Delivery,Tirur,Calicut,Kerala,Tirur,Malappuram,KERALA",
      "Thazhepalam S.O,676101,SO,Delivery,Tirur,Calicut,Kerala,Tirur,Malappuram,KERALA",
    ].join("\n");

    expect(parseIndiaPostPincodeCsv(csv)).toEqual({
      district: "Malappuram",
      state: "KERALA",
      postOffice: "Tirur(kerala) H.O",
    });
  });

  it("normalizes driver names without losing Malayalam letters", () => {
    expect(normalizeDriverName("  Kalesh  K K ")).toBe("kalesh k k");
    expect(normalizeDriverName("ഷാഫി  കെ")).toBe("ഷാഫി കെ");
  });
});
