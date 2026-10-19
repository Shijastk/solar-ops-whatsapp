import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NormalizedWhatsAppMessage } from "../lib/whatsapp";

const { getSupabaseAdminMock, sendOpsReplyMock } = vi.hoisted(() => ({
  getSupabaseAdminMock: vi.fn(),
  sendOpsReplyMock: vi.fn(),
}));

vi.mock("@/lib/supabase-admin", () => ({
  getSupabaseAdmin: getSupabaseAdminMock,
}));
vi.mock("@/lib/replies", () => ({
  sendOpsReply: sendOpsReplyMock,
}));

import { handleFastWhatsAppQuery } from "../lib/whatsapp-queries";

type StockFixture = {
  products: Array<{ id: string; normalized_name: string; active: boolean }>;
  aliases: Array<{ product_id: string; normalized_alias: string }>;
  balances: Array<{
    product_id: string;
    company_id: string;
    company_name: string;
    product_name: string;
    unit: string;
    current_quantity: number;
    balance_known: boolean;
  }>;
};

const originalEnv = {
  key: process.env.GROQ_API_KEY,
  model: process.env.GROQ_MODEL,
};

function message(textBody: string): NormalizedWhatsAppMessage {
  return {
    type: "text",
    messageId: "test-stock-query",
    senderPhone: "0000000000",
    timestamp: new Date("2026-10-19T06:00:00.000Z"),
    textBody,
  } as NormalizedWhatsAppMessage;
}

describe("stock query database-to-reply integration", () => {
  let fixture: StockFixture;

  beforeEach(() => {
    fixture = { products: [], aliases: [], balances: [] };
    sendOpsReplyMock.mockReset().mockResolvedValue(undefined);

    getSupabaseAdminMock.mockReturnValue({
      from(table: string) {
        const filters: Array<[string, unknown]> = [];
        const builder: Record<string, unknown> = {};
        builder.select = () => builder;
        builder.eq = (column: string, value: unknown) => {
          filters.push([column, value]);
          return builder;
        };
        builder.in = (column: string, values: unknown[]) => {
          filters.push([column, values]);
          return builder;
        };
        builder.limit = () => builder;
        builder.order = () => builder;
        builder.then = (resolve: (value: unknown) => unknown) => {
          let data: Array<Record<string, unknown>> =
            table === "stock_products" ? fixture.products
              : table === "stock_product_aliases" ? fixture.aliases
                : table === "stock_balances" ? fixture.balances
                  : [];
          for (const [column, value] of filters) {
            if (column === "product_id" && Array.isArray(value)) {
              data = data.filter((row) => value.includes(row[column]));
            } else {
              data = data.filter((row) => row[column] === value);
            }
          }
          return Promise.resolve(resolve({ data, error: null }));
        };
        return builder;
      },
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("returns the exact product, company, unit, and a known zero balance", async () => {
    fixture.products = [{
      id: "product-zero",
      normalized_name: "emmvee 560 wp topcon dcr panel",
      active: true,
    }];
    fixture.balances = [{
      product_id: "product-zero",
      company_id: "company-a",
      company_name: "Savitr Solar",
      product_name: "Emmvee 560 Wp TOPCon DCR Panel",
      unit: "NOS",
      current_quantity: 0,
      balance_known: true,
    }];

    await expect(
      handleFastWhatsAppQuery(
        message("Emmvee 560 Wp TOPCon DCR Panel stock ethra"),
        "stored-stock-zero",
      ),
    ).resolves.toBe("handled");

    const reply = sendOpsReplyMock.mock.calls[0][0].body as string;
    expect(reply).toContain("Emmvee 560 Wp TOPCon DCR Panel");
    expect(reply).toContain("Savitr Solar");
    expect(reply).toContain("സ്റ്റോക്ക്: 0 NOS");
    expect(reply).not.toContain("count ഇനിയും add ചെയ്തിട്ടില്ല");
    expect(reply).not.toMatch(/₹|price|rate|amount|total/i);
  });

  it("does not turn an unknown balance into a zero balance", async () => {
    fixture.products = [{
      id: "product-unknown",
      normalized_name: "emmvee 560 wp topcon dcr panel",
      active: true,
    }];
    fixture.balances = [{
      product_id: "product-unknown",
      company_id: "company-a",
      company_name: "Savitr Solar",
      product_name: "Emmvee 560 Wp TOPCon DCR Panel",
      unit: "NOS",
      current_quantity: 0,
      balance_known: false,
    }];

    await handleFastWhatsAppQuery(
      message("Emmvee 560 Wp TOPCon DCR Panel stock ethra"),
      "stored-stock-unknown",
    );

    const reply = sendOpsReplyMock.mock.calls[0][0].body as string;
    expect(reply).toContain("count ഇനിയും add ചെയ്തിട്ടില്ല");
    expect(reply).not.toContain("സ്റ്റോക്ക്: 0 NOS");
  });

  it("shows every company match rather than guessing when a product name is ambiguous", async () => {
    fixture.products = [
      {
        id: "product-a",
        normalized_name: "emmvee 560 wp topcon dcr panel",
        active: true,
      },
      {
        id: "product-b",
        normalized_name: "emmvee 560 wp topcon dcr panel",
        active: true,
      },
    ];
    fixture.balances = [
      {
        product_id: "product-a",
        company_id: "company-a",
        company_name: "Savitr Solar",
        product_name: "560 Wp Panel",
        unit: "NOS",
        current_quantity: 12,
        balance_known: true,
      },
      {
        product_id: "product-b",
        company_id: "company-b",
        company_name: "Sun Grid",
        product_name: "560 Wp Panel",
        unit: "PCS",
        current_quantity: 4,
        balance_known: true,
      },
    ];

    await handleFastWhatsAppQuery(
      message("Emmvee 560 Wp TOPCon DCR Panel stock ethra"),
      "stored-stock-ambiguous",
    );

    const reply = sendOpsReplyMock.mock.calls[0][0].body as string;
    expect(reply).toContain("ഒരേ പേരിലുള്ള stock ഒന്നിലധികം കമ്പനികളിലുണ്ട്");
    expect(reply).toContain("Savitr Solar");
    expect(reply).toContain("Sun Grid");
    expect(reply).toContain("12 NOS");
    expect(reply).toContain("4 PCS");
  });

  it("returns a grounded not-found reply when no exact, alias, or safe fuzzy match exists", async () => {
    await handleFastWhatsAppQuery(
      message("Unknown 999 product stock ethra"),
      "stored-stock-not-found",
    );

    const reply = sendOpsReplyMock.mock.calls[0][0].body as string;
    expect(reply).toContain("സുരക്ഷിതമായി match ചെയ്യുന്ന stock item കണ്ടെത്തിയില്ല");
    expect(reply).not.toContain("0");
  });
});
