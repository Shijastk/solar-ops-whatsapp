import { describe, expect, it } from "vitest";
import {
  indiaDayBounds,
  parseFastWhatsAppQuery,
} from "../lib/whatsapp-queries";

describe("fast WhatsApp operational query parsing", () => {
  it("recognizes bounded bill-count intents without AI", () => {
    expect(parseFastWhatsAppQuery("ഇന്ന് എത്ര ബിൽ വന്നു?")).toEqual({
      type: "today_bill_count",
    });
    expect(parseFastWhatsAppQuery("today bill count")).toEqual({
      type: "today_bill_count",
    });
    expect(parseFastWhatsAppQuery("pending bill ethra")).toEqual({
      type: "pending_bill_count",
    });
    expect(parseFastWhatsAppQuery("latest bill")).toEqual({
      type: "latest_bill",
    });
  });

  it("extracts the product phrase from Malayalam and Manglish stock questions", () => {
    expect(
      parseFastWhatsAppQuery("Emmvee 560 Wp Topcon Dcr Panel സ്റ്റോക്ക് എത്ര?"),
    ).toEqual({
      type: "stock_balance",
      productQuery: "Emmvee 560 Wp Topcon Dcr Panel",
    });

    expect(parseFastWhatsAppQuery("Solar 560 panel stock ethra")).toEqual({
      type: "stock_balance",
      productQuery: "Solar 560 panel",
    });
  });

  it("asks for a product instead of guessing when a stock question is incomplete", () => {
    expect(parseFastWhatsAppQuery("സ്റ്റോക്ക് എത്ര?")).toEqual({
      type: "stock_product_required",
    });
  });

  it("does not intercept arbitrary text or correction-only values", () => {
    expect(parseFastWhatsAppQuery("Hello")).toBeNull();
    expect(parseFastWhatsAppQuery("8")).toBeNull();
    expect(parseFastWhatsAppQuery("KL55AF7615")).toBeNull();
  });

  it("calculates the current India day without depending on server timezone", () => {
    expect(
      indiaDayBounds(new Date("2026-10-03T10:16:00.000Z")),
    ).toEqual({
      start: "2026-10-02T18:30:00.000Z",
      end: "2026-10-03T18:30:00.000Z",
    });
  });
});
