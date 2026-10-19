import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NormalizedWhatsAppMessage } from "../lib/whatsapp";

const state = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  ensureStockCatalogForDraft: vi.fn(),
  applyStockOutForDraft: vi.fn(),
  saveCompanyAlias: vi.fn(),
  saveProductAlias: vi.fn(),
  listCompanySuggestions: vi.fn(),
  listProductSuggestions: vi.fn(),
  sendOpsList: vi.fn(),
  sendOpsReply: vi.fn(),
  sendOpsReplyButtons: vi.fn(),
  updates: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/supabase-admin", () => ({
  getSupabaseAdmin: () => ({ from: state.from, rpc: state.rpc }),
}));
vi.mock("@/lib/stock", () => ({
  ensureStockCatalogForDraft: state.ensureStockCatalogForDraft,
  applyStockOutForDraft: state.applyStockOutForDraft,
  saveCompanyAlias: state.saveCompanyAlias,
  saveProductAlias: state.saveProductAlias,
  listCompanySuggestions: state.listCompanySuggestions,
  listProductSuggestions: state.listProductSuggestions,
}));
vi.mock("@/lib/replies", () => ({
  sendOpsList: state.sendOpsList,
  sendOpsReply: state.sendOpsReply,
  sendOpsReplyButtons: state.sendOpsReplyButtons,
}));

import {
  handleStockWorkflowInbound,
  processStockForDraft,
} from "../lib/stock-workflow";

const draftId = "11111111-1111-4111-8111-111111111111";
const messageId = "22222222-2222-4222-8222-222222222222";
const companyId = "33333333-3333-4333-8333-333333333333";
const senderPhone = "919999999999";

function inbound(sender = senderPhone): NormalizedWhatsAppMessage {
  return {
    type: "interactive",
    messageId: "incoming-action",
    senderPhone: sender,
    timestamp: new Date("2026-10-19T06:00:00.000Z"),
    interactiveReply: {
      id: `so:stock:company:${draftId}:${companyId}`,
      title: "Select company",
    },
  } as unknown as NormalizedWhatsAppMessage;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.updates = [];
  state.rpc.mockResolvedValue({
    data: { status: "claimed", draft_id: draftId },
    error: null,
  });
  state.ensureStockCatalogForDraft.mockResolvedValue({
    companyId,
    productIds: ["44444444-4444-4444-8444-444444444444"],
  });
  state.applyStockOutForDraft.mockResolvedValue({
    status: "applied",
    draft_id: draftId,
  });
  state.saveCompanyAlias.mockResolvedValue({ status: "company_alias_saved" });
  state.saveProductAlias.mockResolvedValue({ status: "alias_saved" });
  state.sendOpsList.mockResolvedValue(undefined);
  state.sendOpsReply.mockResolvedValue(undefined);
  state.sendOpsReplyButtons.mockResolvedValue(undefined);
  state.from.mockImplementation((table: string) => {
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.eq = () => builder;
    builder.update = (values: Record<string, unknown>) => {
      state.updates.push(values);
      return builder;
    };
    builder.maybeSingle = async () => {
      if (table === "document_drafts") {
        return {
          data: {
            id: draftId,
            message_id: messageId,
            supplier_name: "Savitr Solar",
            document_number: "INV-100",
          },
          error: null,
        };
      }
      if (table === "whatsapp_messages") {
        return { data: { sender_phone: senderPhone }, error: null };
      }
      return { data: null, error: null };
    };
    builder.then = (
      resolve: (value: unknown) => unknown,
      reject: (reason?: unknown) => unknown,
    ) =>
      Promise.resolve({ data: null, error: null }).then(resolve, reject);
    return builder;
  });
});

describe("stock workflow integration", () => {
  it("authorizes the interactive stock action against the original bill sender", async () => {
    await expect(
      handleStockWorkflowInbound(inbound("918888888888"), "stored-action"),
    ).rejects.toThrow("Stock action does not match the sender");

    expect(state.saveCompanyAlias).not.toHaveBeenCalled();
    expect(state.applyStockOutForDraft).not.toHaveBeenCalled();
  });

  it("applies stock only after the document claim and replies with the persisted result", async () => {
    await expect(
      handleStockWorkflowInbound(inbound(), "stored-action"),
    ).resolves.toBe("handled");

    expect(state.saveCompanyAlias).toHaveBeenCalledWith({
      draftId,
      companyId,
    });
    expect(state.ensureStockCatalogForDraft).toHaveBeenCalledWith(draftId);
    expect(state.applyStockOutForDraft).toHaveBeenCalledTimes(1);
    expect(state.sendOpsReplyButtons).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining("ഒരിക്കൽ മാത്രം രേഖപ്പെടുത്തിയിട്ടുണ്ട്"),
      }),
    );
  });

  it("does not reapply stock when the database claim says the bill is a duplicate", async () => {
    state.rpc.mockResolvedValue({
      data: { status: "duplicate_document", draft_id: draftId },
      error: null,
    });

    await expect(
      processStockForDraft({
        draftId,
        replyToMessageId: messageId,
        notifySuccess: true,
      }),
    ).resolves.toMatchObject({ status: "duplicate_document" });

    expect(state.ensureStockCatalogForDraft).not.toHaveBeenCalled();
    expect(state.applyStockOutForDraft).not.toHaveBeenCalled();
    expect(state.sendOpsReply).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining("സ്റ്റോക്ക് വീണ്ടും കുറച്ചിട്ടില്ല"),
      }),
    );
  });

  it("retries stock processing after a recoverable catalog failure", async () => {
    state.ensureStockCatalogForDraft
      .mockRejectedValueOnce(new Error("temporary catalog failure"))
      .mockResolvedValueOnce({
        companyId,
        productIds: ["44444444-4444-4444-8444-444444444444"],
      });

    await expect(
      processStockForDraft({
        draftId,
        replyToMessageId: messageId,
        suppressNotifications: true,
      }),
    ).rejects.toThrow("temporary catalog failure");

    await expect(
      processStockForDraft({
        draftId,
        replyToMessageId: messageId,
        suppressNotifications: true,
      }),
    ).resolves.toMatchObject({ status: "applied" });

    expect(state.rpc).toHaveBeenCalledTimes(2);
    expect(state.applyStockOutForDraft).toHaveBeenCalledTimes(1);
    expect(state.updates).toContainEqual({
      stock_error: "stock_processing_failed",
      stock_updated_at: expect.any(String),
    });
  });

  it("records a recoverable stock error when catalog or deduction fails", async () => {
    state.ensureStockCatalogForDraft.mockRejectedValue(
      new Error("synthetic catalog failure"),
    );

    await expect(
      processStockForDraft({
        draftId,
        replyToMessageId: messageId,
        suppressNotifications: true,
      }),
    ).rejects.toThrow("synthetic catalog failure");

    expect(state.updates).toContainEqual({
      stock_error: "stock_processing_failed",
      stock_updated_at: expect.any(String),
    });
    expect(state.applyStockOutForDraft).not.toHaveBeenCalled();
    expect(state.sendOpsReplyButtons).not.toHaveBeenCalled();
  });
});
