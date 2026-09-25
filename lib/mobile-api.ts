import { getHealthConfiguration } from "@/lib/env";
import {
  buildOpsConversations,
  listOpsDraftsForMessages,
  listOpsMessages,
  listOpsOutboundMessages,
  type OpsDocumentDraft,
  type OpsMessage,
} from "@/lib/ops-data";
import { verifyOpsSession } from "@/lib/ops-auth";
import { isWithinCustomerServiceWindow } from "@/lib/replies";
import {
  listStockBalances,
  listStockCompanies,
  type StockCompany,
} from "@/lib/stock";

export const MOBILE_API_VERSION = "v1";

export function readMobileBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization")?.trim();
  if (!authorization) return null;

  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return match?.[1]?.trim() || null;
}

export function verifyMobileRequest(
  request: Request,
  now = Date.now(),
): boolean {
  return verifyOpsSession(readMobileBearerToken(request) ?? undefined, now);
}

export function mobileUnauthorizedResponse() {
  return Response.json(
    { error: "Unauthorized" },
    {
      status: 401,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export function maskMobilePhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length <= 4 ? "••••" : "•••• " + digits.slice(-4);
}

export function isPdfOpsMessage(message: OpsMessage): boolean {
  return (
    message.mime_type?.toLowerCase() === "application/pdf" ||
    message.original_filename?.toLowerCase().endsWith(".pdf") === true
  );
}

function dateKey(value: string | Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function displayDay(value: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
  }).format(value);
}

function normalizeCompanyGstin(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return normalized.length === 15 ? normalized : null;
}

export function resolveMobileCompany(
  draft:
    | Pick<OpsDocumentDraft, "stock_company_id" | "supplier_gstin">
    | undefined,
  companies: StockCompany[],
): StockCompany | null {
  if (!draft) return null;

  if (draft.stock_company_id) {
    const mapped = companies.find(
      (company) => company.id === draft.stock_company_id && company.gstin !== null,
    );
    if (mapped) return mapped;
  }

  const supplierGstin = normalizeCompanyGstin(draft.supplier_gstin);
  if (!supplierGstin) return null;

  return (
    companies.find(
      (company) => normalizeCompanyGstin(company.gstin) === supplierGstin,
    ) ?? null
  );
}

function draftNeedsReview(draft: OpsDocumentDraft | undefined): boolean {
  if (!draft) return false;
  return (
    draft.workflow_status === "review_required" ||
    draft.parse_status === "ready_for_review" ||
    draft.parse_status === "needs_review"
  );
}

function serializeDraft(draft: OpsDocumentDraft | undefined) {
  if (!draft) return null;

  return {
    id: draft.id,
    parseStatus: draft.parse_status,
    documentType: draft.document_type,
    supplierName: draft.supplier_name,
    supplierGstin: draft.supplier_gstin,
    supplierAddress: draft.supplier_address,
    documentNumber: draft.document_number,
    documentDate: draft.document_date,
    ewayBillNumber: draft.eway_bill_number,
    consigneeName: draft.consignee_name,
    consigneeAddress: draft.consignee_address,
    consigneeGstin: draft.consignee_gstin,
    buyerName: draft.buyer_name,
    buyerAddress: draft.buyer_address,
    buyerGstin: draft.buyer_gstin,
    destination: draft.destination,
    dispatchFromAddress: draft.dispatch_from_address,
    vehicleNumber: draft.vehicle_number,
    approximateDistanceKm: draft.approximate_distance_km,
    supplyType: draft.supply_type,
    transactionType: draft.transaction_type,
    taxableAmount: draft.taxable_amount,
    cgstAmount: draft.cgst_amount,
    sgstAmount: draft.sgst_amount,
    totalAmount: draft.total_amount,
    missingFields: draft.missing_fields,
    parseError: draft.parse_error,
    extractedAt: draft.extracted_at,
    approvedAt: draft.approved_at,
    verificationStatus: draft.verification_status,
    workflowStatus: draft.workflow_status,
    stockStatus: draft.stock_status,
    stockError: draft.stock_error,
    stockUpdatedAt: draft.stock_updated_at,
    stockCompanyId: draft.stock_company_id,
    items: draft.items.map((item) => ({
      id: item.id,
      lineIndex: item.line_index,
      description: item.description,
      hsnSac: item.hsn_sac,
      quantity: item.quantity,
      unit: item.unit,
      rate: item.rate,
      amount: item.amount,
    })),
  };
}

export async function buildMobileBootstrap(now = new Date()) {
  const [messages, outbound, companies, balances] = await Promise.all([
    listOpsMessages(150),
    listOpsOutboundMessages(250),
    listStockCompanies(),
    listStockBalances(),
  ]);

  const billMessages = messages.filter(isPdfOpsMessage);
  const drafts = await listOpsDraftsForMessages(
    billMessages.map((message) => message.id),
  );

  const bills = billMessages.map((message) => {
    const draft = drafts.get(message.id);
    const company = resolveMobileCompany(draft, companies);
    return {
      id: message.id,
      fileName: message.original_filename || "WhatsApp PDF",
      mimeType: message.mime_type,
      mediaSizeBytes: message.media_size_bytes,
      storageAvailable: Boolean(message.storage_path),
      processingStatus: message.processing_status,
      receivedAt: message.received_at,
      senderName: message.sender_name,
      senderPhoneMasked: maskMobilePhone(message.sender_phone),
      companyId: company?.id ?? null,
      companyName: company?.canonical_name ?? null,
      companyGstin: company?.gstin ?? null,
      draft: serializeDraft(draft),
    };
  });

  const todayKey = dateKey(now);
  const pendingReview = billMessages.filter((message) =>
    draftNeedsReview(drafts.get(message.id)),
  ).length;
  const recorded = billMessages.filter(
    (message) => drafts.get(message.id)?.workflow_status === "recorded",
  ).length;

  const dailyBills = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(now.getTime() - (6 - index) * 24 * 60 * 60 * 1000);
    const key = dateKey(date);
    return {
      key,
      label: displayDay(date),
      count: billMessages.filter((message) => dateKey(message.received_at) === key)
        .length,
    };
  });

  const totalStockQuantity = balances.reduce(
    (sum, balance) => sum + balance.current_quantity,
    0,
  );

  const health = getHealthConfiguration();
  const conversations = buildOpsConversations(messages, outbound).map((conversation) => {
    const latestInbound = conversation.messages[conversation.messages.length - 1] ?? null;
    const timeline = [
      ...conversation.messages.map((message) => ({
        type: "inbound" as const,
        time: message.received_at,
        id: message.id,
        messageType: message.message_type,
        textBody: message.text_body,
        fileName: message.original_filename,
        mimeType: message.mime_type,
        mediaSizeBytes: message.media_size_bytes,
        storageAvailable: Boolean(message.storage_path),
        processingStatus: message.processing_status,
      })),
      ...conversation.outbound.map((message) => ({
        type: "outbound" as const,
        time: message.sent_at || message.created_at,
        id: message.id,
        body: message.body,
        status: message.status,
        errorMessage: message.error_message,
      })),
    ].sort((left, right) => new Date(left.time).getTime() - new Date(right.time).getTime());

    return {
      key: conversation.key,
      senderName: conversation.senderName,
      senderPhoneMasked: maskMobilePhone(conversation.senderPhone),
      latestReceivedAt: conversation.latestReceivedAt,
      latestInboundMessageId: latestInbound?.id ?? null,
      canReply: latestInbound
        ? isWithinCustomerServiceWindow(latestInbound.received_at, now)
        : false,
      timeline,
    };
  });

  return {
    apiVersion: MOBILE_API_VERSION,
    generatedAt: now.toISOString(),
    runtime: {
      healthy: health.validation.webhook && health.validation.ingestion,
      automationEnabled: health.validation.automation.enabled,
      automationReady: health.validation.automation.ready,
    },
    dashboard: {
      billsToday: billMessages.filter(
        (message) => dateKey(message.received_at) === todayKey,
      ).length,
      totalBills: billMessages.length,
      pendingReview,
      recorded,
      inboundMessages: messages.length,
      stockProducts: balances.length,
      totalStockQuantity,
      dailyBills,
    },
    bills,
    conversations,
    dispatches: bills
      .filter((bill) => bill.draft !== null)
      .map((bill) => ({
        billId: bill.id,
        fileName: bill.fileName,
        receivedAt: bill.receivedAt,
        documentNumber: bill.draft?.documentNumber ?? null,
        companyId: bill.companyId,
        companyName: bill.companyName ?? bill.draft?.supplierName ?? null,
        companyGstin: bill.companyGstin ?? bill.draft?.supplierGstin ?? null,
        destination: bill.draft?.destination ?? null,
        consigneeName: bill.draft?.consigneeName ?? null,
        vehicleNumber: bill.draft?.vehicleNumber ?? null,
        workflowStatus: bill.draft?.workflowStatus ?? "unknown",
        stockStatus: bill.draft?.stockStatus ?? "unknown",
      })),
    stock: {
      companies: companies.map((company) => ({
        id: company.id,
        name: company.canonical_name,
        gstin: company.gstin,
      })),
      balances: balances.map((balance) => ({
        productId: balance.product_id,
        companyId: balance.company_id,
        companyName: balance.company_name,
        companyGstin: balance.company_gstin,
        productName: balance.product_name,
        unit: balance.unit,
        hsnSac: balance.hsn_sac,
        currentQuantity: balance.current_quantity,
      })),
    },
  };
}
