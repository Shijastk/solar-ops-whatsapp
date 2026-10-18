import { describe, expect, it } from "vitest";
import {
  buildTripDisplayName,
  cleanDestination,
  combineTripItems,
  choosePrimaryDestination,
  classifyTripTextCommand,
  classifyNaturalTripStartCommand,
  extractTripStartDriverQuery,
  looksLikePotentialTripStartRequest,
  normalizeDriverName,
  parseIndiaPostPincodeCsv,
} from "../lib/trips";

describe("WhatsApp trip capture helpers", () => {
  it("recognizes fast trip commands without AI", () => {
    expect(classifyTripTextCommand("trip")).toBe("start");
    expect(classifyTripTextCommand("New Trip")).toBe("start");
    expect(classifyTripTextCommand("Create a new trip")).toBeNull();
    expect(classifyTripTextCommand("I want to start a new trip")).toBeNull();
    expect(classifyTripTextCommand("trip create cheyyu")).toBeNull();
    expect(classifyTripTextCommand("പുതിയ ട്രിപ്പ് തുടങ്ങൂ")).toBeNull();
    expect(classifyNaturalTripStartCommand("Create a new trip")).toBe(true);
    expect(classifyNaturalTripStartCommand("I want to start a new trip")).toBe(true);
    expect(classifyNaturalTripStartCommand("trip create cheyyu")).toBe(true);
    expect(classifyNaturalTripStartCommand("പുതിയ ട്രിപ്പ് തുടങ്ങൂ")).toBe(true);
    expect(classifyTripTextCommand("varum trip")).toBe("start");
    expect(classifyTripTextCommand("വരും ട്രിപ്പ്")).toBe("start");
    expect(classifyTripTextCommand("ട്രിപ്പ്")).toBe("start");
    expect(extractTripStartDriverQuery("trip Rasheed")).toBe("rasheed");
    expect(extractTripStartDriverQuery("varum trip Rasheed")).toBe("rasheed");
    expect(extractTripStartDriverQuery("ട്രിപ്പ് റഷീദ്")).toBe("റഷീദ്");
    expect(extractTripStartDriverQuery("trip latest")).toBeNull();
    expect(extractTripStartDriverQuery("trip create cheyyanam")).toBeNull();
    expect(extractTripStartDriverQuery("new trip with Rasheed")).toBeNull();
    expect(looksLikePotentialTripStartRequest("I need a new trip for Rasheed")).toBe(true);
    expect(looksLikePotentialTripStartRequest("Please open a new trip with Unknown Driver")).toBe(true);
    expect(looksLikePotentialTripStartRequest("I want to know today's trip details")).toBe(false);
    expect(looksLikePotentialTripStartRequest("show latest trip")).toBe(false);
    expect(looksLikePotentialTripStartRequest("I need trip data")).toBe(false);
    expect(looksLikePotentialTripStartRequest("I need a trip for tomorrow")).toBe(false);
    expect(classifyTripTextCommand("done")).toBe("done");
    expect(classifyTripTextCommand("ശരി")).toBe("done");
    expect(classifyTripTextCommand("complete")).toBe("done");
    expect(classifyTripTextCommand("cancel trip")).toBe("cancel");
    expect(classifyTripTextCommand("Emmvee 560 panel")).toBeNull();
  });

  it("keeps the first uploaded destination when destination counts tie", () => {
    expect(
      choosePrimaryDestination(["Tirur", "Kottakkal", "Tirur", "Kottakkal"]),
    ).toBe("Tirur");

    expect(choosePrimaryDestination(["Kottakkal", "Tirur"])).toBe("Kottakkal");
  });

  it("resolves final ties by upload order even after a temporary leader", () => {
    expect(
      choosePrimaryDestination(["Tirur", "Palakkad", "Palakkad", "Tirur"]),
    ).toBe("Tirur");
  });
  it("rejects address labels and strips phone numbers from routes", () => {
    expect(cleanDestination("State Name : Kerala, Code : 32")).toBeNull();
    expect(cleanDestination("Palakkad - 678633 Mobile No :- 0000000000")).toBe(
      "Palakkad",
    );
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

  it("combines matching trip products without merging distinct models or units", () => {
    expect(
      combineTripItems([
        { id: "1", draft_id: "a", description: "Emmvee 560 Wp Panel", hsn_sac: "8541", quantity: 2, unit: "NOS" },
        { id: "2", draft_id: "b", description: "EMMVEE 560 WP PANEL", hsn_sac: "8541", quantity: 3, unit: "NOS" },
        { id: "3", draft_id: "c", description: "Emmvee 210 Wp Panel", hsn_sac: "8541", quantity: 1, unit: "NOS" },
        { id: "4", draft_id: "d", description: "Emmvee 560 Wp Panel", hsn_sac: "8541", quantity: 4, unit: "PCS" },
      ]),
    ).toEqual([
      { description: "Emmvee 560 Wp Panel", hsnSac: "8541", quantity: 5, unit: "NOS" },
      { description: "Emmvee 210 Wp Panel", hsnSac: "8541", quantity: 1, unit: "NOS" },
      { description: "Emmvee 560 Wp Panel", hsnSac: "8541", quantity: 4, unit: "PCS" },
    ]);
  });

  it("keeps rows with unknown quantities separate instead of treating them as zero", () => {
    expect(
      combineTripItems([
        { id: "1", draft_id: "a", description: "Panel", hsn_sac: null, quantity: null, unit: "NOS" },
        { id: "2", draft_id: "b", description: "Panel", hsn_sac: null, quantity: null, unit: "NOS" },
      ]),
    ).toHaveLength(2);
  });

  it("normalizes driver names without losing Malayalam letters", () => {
    expect(normalizeDriverName("  Kalesh  K K ")).toBe("kalesh k k");
    expect(normalizeDriverName("ഷാഫി  കെ")).toBe("ഷാഫി കെ");
  });
});
