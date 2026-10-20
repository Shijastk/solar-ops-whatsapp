import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NormalizedWhatsAppMessage } from "../lib/whatsapp";

const state = vi.hoisted(() => ({
  getSupabaseAdmin: vi.fn(),
  sendOpsReply: vi.fn(),
  generateUniversalWhatsAppReply: vi.fn(),
  classifyOperationalQueryWithGroq: vi.fn(),
  looksLikeOperationalQuery: vi.fn(),
  selects: [] as Array<{ table: string; columns: string }>,
}));

vi.mock("@/lib/supabase-admin", () => ({
  getSupabaseAdmin: state.getSupabaseAdmin,
}));
vi.mock("@/lib/replies", () => ({
  sendOpsReply: state.sendOpsReply,
}));
vi.mock("@/lib/whatsapp-query-intent", () => ({
  classifyOperationalQueryWithGroq: state.classifyOperationalQueryWithGroq,
  looksLikeOperationalQuery: state.looksLikeOperationalQuery,
}));
vi.mock("@/lib/whatsapp-fallback", () => ({
  fixedOperationalFallback: vi.fn(() => "fallback"),
  voiceQueryClarification: vi.fn(() => "clarify"),
  fixedUniversalFallback: vi.fn(() => "fallback"),
  generateUniversalWhatsAppReply: state.generateUniversalWhatsAppReply,
}));

import { handleFastWhatsAppQuery } from "../lib/whatsapp-queries";
import { isPricingQuestion, pricingPolicyReply } from "../lib/pricing-policy";

function message(textBody: string): NormalizedWhatsAppMessage {
  return {
    type: "text",
    messageId: "incoming-message",
    senderPhone: "919999999999",
    timestamp: new Date("2026-10-19T06:00:00.000Z"),
    textBody,
  } as unknown as NormalizedWhatsAppMessage;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.selects = [];
  state.sendOpsReply.mockResolvedValue(undefined);
  state.classifyOperationalQueryWithGroq.mockResolvedValue(null);
  state.looksLikeOperationalQuery.mockReturnValue(true);
  state.generateUniversalWhatsAppReply.mockResolvedValue("fallback");
});

describe("WhatsApp pricing restriction", () => {
  it.each([
    "price of Emmvee 560 panel",
    "rate ethra",
    "invoice amount",
    "₹25000",
    "വില എത്രയാണ്",
    "ഇതിന്റെ തുക പറയൂ",
    "vilayethra",
  ])("recognizes pricing request: %s", (text) => {
    expect(isPricingQuestion(text)).toBe(true);
  });

  it.each(["Emmvee 560 panel stock", "today total trips", "Rasheed innale ethra trip poyi"])(
    "does not block a non-pricing operational query: %s",
    (text) => {
      expect(isPricingQuestion(text)).toBe(false);
    },
  );

  it("answers pricing requests without querying the database or invoking AI", async () => {
    await expect(
      handleFastWhatsAppQuery(message("price of Emmvee 560 panel"), "stored-message"),
    ).resolves.toBe("handled");

    expect(state.sendOpsReply).toHaveBeenCalledWith(
      expect.objectContaining({ body: pricingPolicyReply() }),
    );
    expect(state.getSupabaseAdmin).not.toHaveBeenCalled();
    expect(state.classifyOperationalQueryWithGroq).not.toHaveBeenCalled();
    expect(state.generateUniversalWhatsAppReply).not.toHaveBeenCalled();
  });

  it("does not expose invoice totals in the latest bill reply or fetch the total field", async () => {
    state.classifyOperationalQueryWithGroq.mockResolvedValue({
      intent: "latest_bill",
      product_query: null,
      driver_name: null,
      yesterday: false,
      period: null,
      reply: null,
    });
    state.getSupabaseAdmin.mockReturnValue({
      from: (table: string) => {
        const builder: Record<string, unknown> = {};
        builder.select = (columns: string) => {
          state.selects.push({ table, columns });
          return builder;
        };
        builder.eq = () => builder;
        builder.or = () => builder;
        builder.order = () => builder;
        builder.limit = () => builder;
        builder.maybeSingle = async () =>
          table === "whatsapp_messages"
            ? {
                data: {
                  id: "bill-message",
                  original_filename: "invoice.pdf",
                  received_at: "2026-10-19T05:00:00.000Z",
                },
                error: null,
              }
            : {
                data: {
                  supplier_name: "Savitr Solar",
                  document_number: "INV-2026-001",
                  total_amount: 176026.86,
                  workflow_status: "recorded",
                  stock_status: "applied",
                },
                error: null,
              };
        return builder;
      },
    });

    await expect(
      handleFastWhatsAppQuery(message("latest bill"), "stored-message"),
    ).resolves.toBe("handled");

    const reply = String(state.sendOpsReply.mock.calls[0]?.[0]?.body);
    expect(reply).toContain("INV-2026-001");
    expect(reply).not.toContain("176026.86");
    expect(reply).not.toContain("₹");
    expect(reply).not.toContain("ആകെ");
    expect(state.selects.every((selection) => !selection.columns.includes("total_amount"))).toBe(
      true,
    );
  });
});
