import { deterministicUuid } from "@/lib/idempotency";
import { sendOpsList, sendOpsReply, sendOpsReplyButtons } from "@/lib/replies";
import {
  applyStockOutForDraft,
  ensureStockCatalogForDraft,
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
  return draft.documentNumber ? "ബിൽ " + draft.documentNumber : "ഈ ബിൽ";
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
      "-ന്റെ outgoing stock history-ൽ രേഖപ്പെടുത്തി. ഒരിക്കൽ മാത്രം രേഖപ്പെടുത്തിയിട്ടുണ്ട്.",
    buttons: [
      { id: "so:doc:edit:" + draft.id, title: "ബിൽ തിരുത്തുക" },
      { id: "so:doc:delete:" + draft.id, title: "ഒഴിവാക്കുക" },
    ],
  });
}

async function notifyCompanyMatch(
  draft: DraftStockContext,
  replyToMessageId: string,
) {
  const supplierName = draft.supplierName?.trim() || "അജ്ഞാത കമ്പനി";
  const suggestions = await listCompanySuggestions(supplierName, 9);

  if (suggestions.length === 0) {
    await sendOpsReply({
      requestId: deterministicUuid("stock-company-missing:" + draft.id),
      replyToMessageId,
      body:
        "⚠️ സ്റ്റോക്കിൽ മാറ്റമൊന്നും വരുത്തിയിട്ടില്ല. ഈ ബില്ലിലെ കമ്പനി Opening Stock-ൽ ഇതുവരെ ചേർത്തിട്ടില്ല: " +
        supplierName +
        ". Solar Ops Stock-ൽ കമ്പനി/സാധനത്തിന്റെ Opening Stock ചേർത്ത ശേഷം ബിൽ വീണ്ടും പ്രോസസ് ചെയ്യുക.",
    });
    return;
  }

  await sendOpsList({
    requestId: deterministicUuid("stock-company-match:" + draft.id),
    replyToMessageId,
    body:
      "⚠️ ബില്ലിലെ കമ്പനി Opening Stock കമ്പനിയുമായി ബന്ധിപ്പിച്ചിട്ടില്ലാത്തതിനാൽ സ്റ്റോക്ക് മാറ്റിയിട്ടില്ല. ബില്ലിൽ കാണുന്നത്: " +
      supplierName +
      "\n\nശരിയായ Opening Stock കമ്പനി തിരഞ്ഞെടുക്കുക. ഭാവിയിലെ ബില്ലുകൾക്കായി ഈ ബന്ധം ഓർമ്മിച്ചുവയ്ക്കും.",
    buttonText: "കമ്പനി തിരഞ്ഞെടുക്കുക",
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
        "⚠️ സാധനത്തിന്റെ ബന്ധിപ്പിക്കൽ വിവരങ്ങൾ പൂർത്തിയായിട്ടില്ലാത്തതിനാൽ സ്റ്റോക്ക് മാറ്റിയിട്ടില്ല. Solar Ops-ൽ ബിൽ പരിശോധിക്കുക.",
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
        "⚠️ സ്റ്റോക്കിൽ മാറ്റമൊന്നും വരുത്തിയിട്ടില്ല. ഈ സാധനവുമായി പൊരുത്തപ്പെടുന്ന Opening Stock സാധനം കണ്ടെത്തിയില്ല: " +
        result.description +
        (result.unit ? " (" + result.unit + ")" : "") +
        ". Solar Ops Stock-ൽ ഈ സാധനം ചേർത്ത ശേഷം ബിൽ വീണ്ടും പ്രോസസ് ചെയ്യുക.",
    });
    return;
  }

  await sendOpsList({
    requestId: deterministicUuid(
      "stock-product-match:" + draft.id + ":" + result.item_id,
    ),
    replyToMessageId,
    body:
      "⚠️ ബില്ലിലെ ഈ സാധനം Opening Stock സാധനവുമായി ബന്ധിപ്പിച്ചിട്ടില്ലാത്തതിനാൽ സ്റ്റോക്ക് മാറ്റിയിട്ടില്ല:\n" +
      result.description +
      (result.unit ? " — " + result.unit : "") +
      "\n\nശരിയായ Opening Stock സാധനം തിരഞ്ഞെടുക്കുക. ഈ പേര് ഭാവിയിലെ ബില്ലുകൾക്കായി ഓർമ്മിച്ചുവയ്ക്കും.",
    buttonText: "സാധനം തിരഞ്ഞെടുക്കുക",
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
  const product = result.product_name || "സാധനം";
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
      "❌ സ്റ്റോക്ക് അപ്ഡേറ്റ് തടഞ്ഞു.\n" +
      product +
      "\nആവശ്യം: " +
      required +
      "\nലഭ്യമായത്: " +
      available +
      "\n\nഈ ബില്ലിനായി സ്റ്റോക്ക് ഒന്നും കുറച്ചിട്ടില്ല.",
    buttons: [
      { id: "so:doc:edit:" + draft.id, title: "ബിൽ തിരുത്തുക" },
      { id: "so:doc:delete:" + draft.id, title: "ഒഴിവാക്കുക" },
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
      " രേഖപ്പെടുത്തി. പക്ഷേ സ്റ്റോക്ക് വിവരങ്ങൾ സുരക്ഷിതമായി പ്രയോഗിക്കാൻ കഴിഞ്ഞില്ലാത്തതിനാൽ സ്റ്റോക്ക് മാറ്റിയിട്ടില്ല. നില: " +
      result.status.replaceAll("_", " ") +
      ". തുടരുന്നതിന് മുമ്പ് പരിശോധിക്കുക.",
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

  await ensureStockCatalogForDraft(input.draftId);
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

    if (result.status === "duplicate_document") {
      if (input.notifySuccess) {
        await sendOpsReply({
          requestId: deterministicUuid("stock-duplicate-document:" + draft.id),
          replyToMessageId: input.replyToMessageId,
          body:
            "ℹ️ " +
            documentLabel(draft) +
            " നേരത്തെ അപ്‌ലോഡ് ചെയ്തപ്പോൾ തന്നെ സ്റ്റോക്കിൽ രേഖപ്പെടുത്തിയതാണ്. സ്റ്റോക്ക് വീണ്ടും കുറച്ചിട്ടില്ല.",
        });
      }
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
