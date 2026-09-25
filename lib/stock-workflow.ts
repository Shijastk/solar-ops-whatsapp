import { deterministicUuid } from "@/lib/idempotency";
import { sendOpsList, sendOpsReply, sendOpsReplyButtons } from "@/lib/replies";
import {
  applyStockOutForDraft,
  listCompanySuggestions,
  listProductSuggestions,
  saveCompanyAlias,
  saveProductAlias,
  type StockResult,
} from "@/lib/stock";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type { NormalizedWhatsAppMessage } from "@/lib/whatsapp";

type StockWorkflowAction =
  | {
      type: "company";
      draftId: string;
      companyId: string;
    }
  | {
      type: "product";
      draftId: string;
      itemId: string;
      productId: string;
    };

type DraftStockContext = {
  id: string;
  messageId: string;
  senderPhone: string;
  supplierName: string | null;
  documentNumber: string | null;
};

function shortTitle(value: string, max = 24): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return normalized.slice(0, Math.max(1, max - 1)).trimEnd() + "…";
}

export function parseStockWorkflowAction(
  value: string,
): StockWorkflowAction | null {
  const parts = value.split(":");
  if (parts[0] !== "so" || parts[1] !== "stock") return null;

  if (parts[2] === "company" && parts.length === 5) {
    return {
      type: "company",
      draftId: parts[3],
      companyId: parts[4],
    };
  }

  if (parts[2] === "product" && parts.length === 6) {
    return {
      type: "product",
      draftId: parts[3],
      itemId: parts[4],
      productId: parts[5],
    };
  }

  return null;
}

async function loadDraftContext(
  draftId: string,
): Promise<DraftStockContext | null> {
  const supabase = getSupabaseAdmin();
  const { data: draft, error: draftError } = await supabase
    .from("document_drafts")
    .select("id, message_id, supplier_name, document_number")
    .eq("id", draftId)
    .maybeSingle();

  if (draftError) {
    throw new Error("Failed to load stock draft: " + draftError.message);
  }
  if (!draft) return null;

  const { data: message, error: messageError } = await supabase
    .from("whatsapp_messages")
    .select("sender_phone")
    .eq("id", draft.message_id)
    .maybeSingle();

  if (messageError) {
    throw new Error("Failed to load stock draft sender: " + messageError.message);
  }
  if (!message) {
    throw new Error("Stock draft sender was not found");
  }

  return {
    id: draft.id,
    messageId: draft.message_id,
    senderPhone: message.sender_phone,
    supplierName: draft.supplier_name,
    documentNumber: draft.document_number,
  };
}

async function assertDraftSender(
  draftId: string,
  senderPhone: string,
): Promise<DraftStockContext> {
  const draft = await loadDraftContext(draftId);
  if (!draft || draft.senderPhone !== senderPhone) {
    throw new Error("Stock action does not match the sender");
  }
  return draft;
}

function documentLabel(draft: DraftStockContext): string {
  return draft.documentNumber ? "Bill " + draft.documentNumber : "This bill";
}

async function sendSuccess(
  draft: DraftStockContext,
  replyToMessageId: string,
  requestSeed: string,
) {
  await sendOpsReplyButtons({
    requestId: deterministicUuid(requestSeed),
    replyToMessageId,
    body:
      "✅ " +
      documentLabel(draft) +
      " stock updated successfully. The deduction was applied once only.",
    buttons: [
      { id: "so:doc:edit:" + draft.id, title: "Edit bill" },
      { id: "so:doc:delete:" + draft.id, title: "Delete" },
    ],
  });
}

async function notifyCompanyMatch(
  draft: DraftStockContext,
  replyToMessageId: string,
) {
  const supplierName = draft.supplierName?.trim() || "Unknown supplier";
  const suggestions = await listCompanySuggestions(supplierName, 9);

  if (suggestions.length === 0) {
    await sendOpsReply({
      requestId: deterministicUuid("stock-company-missing:" + draft.id),
      replyToMessageId,
      body:
        "⚠️ Stock was not changed. The bill company is not in Opening Stock yet: " +
        supplierName +
        ". Add the company/product opening stock in Solar Ops Stock setup, then process the bill again.",
    });
    return;
  }

  await sendOpsList({
    requestId: deterministicUuid("stock-company-match:" + draft.id),
    replyToMessageId,
    body:
      "⚠️ Stock was not changed because the bill company name is not mapped. Bill shows: " +
      supplierName +
      "\n\nChoose the correct Opening Stock company. This mapping will be remembered for future bills.",
    buttonText: "Choose company",
    rows: suggestions.map((company) => ({
      id: "so:stock:company:" + draft.id + ":" + company.id,
      title: shortTitle(company.canonical_name),
      description: company.gstin ? "GSTIN " + company.gstin : undefined,
    })),
  });
}

async function notifyProductMatch(
  draft: DraftStockContext,
  replyToMessageId: string,
  result: StockResult,
) {
  if (!result.company_id || !result.item_id || !result.description) {
    await sendOpsReply({
      requestId: deterministicUuid("stock-product-invalid:" + draft.id),
      replyToMessageId,
      body:
        "⚠️ Stock was not changed because the product mapping request was incomplete. Please review the bill in Solar Ops.",
    });
    return;
  }

  const suggestions = await listProductSuggestions({
    companyId: result.company_id,
    description: result.description,
    unit: result.unit,
    limit: 9,
  });

  if (suggestions.length === 0) {
    await sendOpsReply({
      requestId: deterministicUuid(
        "stock-product-missing:" + draft.id + ":" + result.item_id,
      ),
      replyToMessageId,
      body:
        "⚠️ Stock was not changed. No Opening Stock product matches: " +
        result.description +
        (result.unit ? " (" + result.unit + ")" : "") +
        ". Add this product in Solar Ops Stock setup, then process the bill again.",
    });
    return;
  }

  await sendOpsList({
    requestId: deterministicUuid(
      "stock-product-match:" + draft.id + ":" + result.item_id,
    ),
    replyToMessageId,
    body:
      "⚠️ Stock was not changed because this bill item is not mapped:\n" +
      result.description +
      (result.unit ? " — " + result.unit : "") +
      "\n\nChoose the correct Opening Stock product. The spelling will be remembered for future bills.",
    buttonText: "Choose product",
    rows: suggestions.map((product) => ({
      id:
        "so:stock:product:" +
        draft.id +
        ":" +
        result.item_id +
        ":" +
        product.id,
      title: shortTitle(product.canonical_name),
      description:
        shortTitle(product.unit + (product.hsn_sac ? " · HSN " + product.hsn_sac : ""), 72),
    })),
  });
}

async function notifyInsufficient(
  draft: DraftStockContext,
  replyToMessageId: string,
  result: StockResult,
) {
  const product = result.product_name || "Product";
  const available = result.available ?? 0;
  const required = result.required ?? 0;

  await sendOpsReplyButtons({
    requestId: deterministicUuid(
      "stock-insufficient:" +
        draft.id +
        ":" +
        (result.product_id ?? "unknown"),
    ),
    replyToMessageId,
    body:
      "❌ Stock update blocked.\n" +
      product +
      "\nRequired: " +
      required +
      "\nAvailable: " +
      available +
      "\n\nNo stock was deducted from this bill.",
    buttons: [
      { id: "so:doc:edit:" + draft.id, title: "Edit bill" },
      { id: "so:doc:delete:" + draft.id, title: "Delete" },
    ],
  });
}

async function notifyUnsafeState(
  draft: DraftStockContext,
  replyToMessageId: string,
  result: StockResult,
) {
  await sendOpsReply({
    requestId: deterministicUuid(
      "stock-review:" + draft.id + ":" + result.status,
    ),
    replyToMessageId,
    body:
      "⚠️ " +
      documentLabel(draft) +
      " was recorded, but stock was not changed because the stock data could not be applied safely. Status: " +
      result.status.replaceAll("_", " ") +
      ". Please review it before continuing.",
  });
}

export async function processStockForDraft(input: {
  draftId: string;
  replyToMessageId: string;
  notifySuccess?: boolean;
}): Promise<StockResult> {
  const draft = await loadDraftContext(input.draftId);
  if (!draft) {
    throw new Error("Stock draft was not found");
  }

  const result = await applyStockOutForDraft(input.draftId);

  try {
    if (result.status === "applied" || result.status === "already_applied") {
      if (input.notifySuccess) {
        await sendSuccess(
          draft,
          input.replyToMessageId,
          "stock-success:" + draft.id,
        );
      }
      return result;
    }

    if (result.status === "company_unmapped") {
      await notifyCompanyMatch(draft, input.replyToMessageId);
      return result;
    }

    if (result.status === "needs_product_match") {
      await notifyProductMatch(draft, input.replyToMessageId, result);
      return result;
    }

    if (result.status === "insufficient_stock") {
      await notifyInsufficient(draft, input.replyToMessageId, result);
      return result;
    }

    await notifyUnsafeState(draft, input.replyToMessageId, result);
    return result;
  } catch (error) {
    console.warn("Stock workflow notification did not complete", {
      status: result.status,
      reason:
        error instanceof Error
          ? error.message.slice(0, 180)
          : "Unknown notification error",
    });
    return result;
  }
}

export async function handleStockWorkflowInbound(
  message: NormalizedWhatsAppMessage,
  storedMessageId: string,
): Promise<"handled" | "ignored"> {
  const action = message.interactiveReply
    ? parseStockWorkflowAction(message.interactiveReply.id)
    : null;

  if (!action) return "ignored";

  const draft = await assertDraftSender(action.draftId, message.senderPhone);

  if (action.type === "company") {
    const mapped = await saveCompanyAlias({
      draftId: action.draftId,
      companyId: action.companyId,
    });

    if (
      mapped.status !== "company_alias_saved" &&
      mapped.status !== "company_alias_exists"
    ) {
      await notifyUnsafeState(draft, storedMessageId, mapped);
      return "handled";
    }

    await processStockForDraft({
      draftId: action.draftId,
      replyToMessageId: storedMessageId,
      notifySuccess: true,
    });
    return "handled";
  }

  const mapped = await saveProductAlias({
    draftId: action.draftId,
    itemId: action.itemId,
    productId: action.productId,
  });

  if (mapped.status !== "alias_saved" && mapped.status !== "alias_exists") {
    await notifyUnsafeState(draft, storedMessageId, mapped);
    return "handled";
  }

  await processStockForDraft({
    draftId: action.draftId,
    replyToMessageId: storedMessageId,
    notifySuccess: true,
  });
  return "handled";
}
