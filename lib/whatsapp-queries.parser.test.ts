import { describe, expect, it } from "vitest";
import { isDriverRelatedQuestion, parseFastWhatsAppQuery } from "@/lib/whatsapp-queries";

describe("parseFastWhatsAppQuery driver trip requests", () => {
  it("extracts a Malayalam name that appears before 'എന്ന ഡ്രൈവർ'", () => {
    expect(parseFastWhatsAppQuery("റഷീദ് എന്ന ഡ്രൈവർ ഇന്ന് എത്ര ട്രിപ്പുകൾ പോയിട്ടുണ്ട്?")).toEqual({
      type: "driver_trip_summary",
      driverName: "റഷീദ്",
      yesterday: false,
    });
  });

  it("extracts a driver name when the request asks about yesterday", () => {
    expect(parseFastWhatsAppQuery("റഷീദ് എന്ന ഡ്രൈവർ ഇന്നലെ എത്ര ട്രിപ്പുകൾ പോയി?")).toEqual({
      type: "driver_trip_summary",
      driverName: "റഷീദ്",
      yesterday: true,
    });
  });

  it("continues to support the English driver-name-first form", () => {
    expect(parseFastWhatsAppQuery("driver Rasheed today trips")).toEqual({
      type: "driver_trip_summary",
      driverName: "Rasheed",
      yesterday: false,
    });
  });
});

describe("isDriverRelatedQuestion voice transcript guard", () => {
  it("recognizes a common garbled Malayalam ASR spelling of driver", () => {
    expect(isDriverRelatedQuestion("ടൃഷീദയം എന്നാന ട്രാഇവര ഇന്ന്യ ട്രിപ്പുകൾ പോയിട്ടുണ്ടോ?")).toBe(true);
  });
});
