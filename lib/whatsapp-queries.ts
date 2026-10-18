import { normalizeProductDescription } from "@/lib/document-parser";
import { deterministicUuid } from "@/lib/idempotency";
import {
  classifyOperationalQueryWithGroq,
  looksLikeOperationalQuery,
  type AiOperationalQueryClassification,
} from "@/lib/whatsapp-query-intent";
import { sendOpsReply } from "@/lib/replies";
import {
  fixedOperationalFallback,
  voiceQueryClarification,
  fixedUniversalFallback,
  generateUniversalWhatsAppReply,
} from "@/lib/whatsapp-fallback";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type { NormalizedWhatsAppMessage } from "@/lib/whatsapp";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const MAX_STOCK_MATCHES = 8;
const MIN_FUZZY_STOCK_SCORE = 0.25;

export type OpsPeriod =
  | "this_week"
  | "this_month"
  | "this_year"
  | "last_week"
  | "last_month"
  | "last_year";

export type FastWhatsAppQuery =
  | { type: "today_bill_count" }
  | { type: "pending_bill_count" }
  | { type: "latest_bill" }
  | { type: "stock_balance"; productQuery: string }
  | { type: "stock_product_required" }
  | { type: "today_trip_summary" }
  | { type: "yesterday_trip_summary" }
  | { type: "driver_trip_summary"; driverName: string; yesterday: boolean }
  | { type: "driver_count" }
  | { type: "today_products_summary" }
  | { type: "yesterday_products_summary" }
  | { type: "latest_trip" }
  | { type: "ops_period_summary"; period: OpsPeriod };

const BILL_TERMS = [
  "bill",
  "bills",
  "invoice",
  "invoices",
  "ബിൽ",
  "ബില്ല്",
  "ബില്ലുകൾ",
];

const COUNT_TERMS = [
  "count",
  "how many",
  "number",
  "ethra",
  "എത്ര",
  "എണ്ണം",
];

const TODAY_TERMS = [
  "today",
  "innu",
  "innathe",
  "inn",
  "ഇന്ന്",
  "ഇന്നത്തെ",
];

const YESTERDAY_TERMS = ["yesterday", "innale", "ഇന്നലെ", "കഴിഞ്ഞ ദിവസം"];

const PENDING_TERMS = [
  "pending",
  "review",
  "pendingulla",
  "പെൻഡിങ്",
  "പെൻഡിംഗ്",
  "പരിശോധിക്കാനുള്ള",
  "കാത്തിരിക്കുന്ന",
  "needs checking",
  "need checking",
  "check needed",
  "to check",
  "check cheyyan",
  "check cheyyanam",
  "verify",
  "verification",
  "ചെക്ക് ചെയ്യാനുള്ള",
  "ചെക്ക് ചെയ്യണം",
  "പരിശോധിക്കണം",
  "പരിശോധിക്കേണ്ട",
  "വെരിഫൈ",
];

const LATEST_TERMS = [
  "latest",
  "last bill",
  "recent bill",
  "avasana",
  "അവസാന",
  "അവസാനത്തെ",
  "ലാസ്റ്റ്",
];

const STOCK_TERMS = ["stock", "സ്റ്റോക്ക്"];
const TRIP_TERMS = ["trip", "trips", "ട്രിപ്പ്", "ട്രിപ്പുകൾ"];
const PRODUCT_TERMS = [
  "product",
  "products",
  "item",
  "items",
  "സാധനം",
  "സാധനങ്ങൾ",
  "ഉൽപ്പന്നം",
  "ഉൽപ്പന്നങ്ങൾ",
  "പ്രോഡക്റ്റ്",
  "പ്രൊഡക്റ്റ്",
  "പ്രൊഡക്റ്റുകൾ",
  "പ്രൊഡക്ട്",
  "പ്രോഡക്റ്റുകൾ",
];
const TODAY_PRODUCT_MOVEMENT_TERMS = [
  "poya",
  "poyi",
  "went",
  "went out",
  "sent out",
  "delivered",
  "dispatched",
  "dispatch",
  "despatch",
  "പോയി",
  "പോയ",
  "പോയത്",
  "പുറത്തുപോയ",
];
const TRIP_LATEST_TERMS = ["latest", "last", "recent", "അവസാന", "ലാസ്റ്റ്"];

const PERIOD_TERMS: Array<{ period: OpsPeriod; terms: string[] }> = [
  {
    period: "last_week",
    terms: ["last week", "previous week", "kazhinja week", "കഴിഞ്ഞ ആഴ്ച"],
  },
  {
    period: "last_month",
    terms: ["last month", "previous month", "kazhinja month", "കഴിഞ്ഞ മാസം"],
  },
  {
    period: "last_year",
    terms: ["last year", "previous year", "kazhinja year", "കഴിഞ്ഞ വർഷം"],
  },
  {
    period: "this_week",
    terms: ["this week", "ee week", "ഈ ആഴ്ച", "ഈ വാരം"],
  },
  {
    period: "this_month",
    terms: ["this month", "ee month", "ഈ മാസം"],
  },
  {
    period: "this_year",
    terms: ["this year", "ee year", "ഈ വർഷം"],
  },
];

const STOCK_QUESTION_TERMS = [
  "balance",
  "available",
  "availability",
  "remaining",
  "left",
  "qty",
  "quantity",
  "ethra",
  "undo",
  "bakki",
  "എത്ര",
  "ബാക്കി",
  "ഉണ്ടോ",
  "ഉണ്ട്",
  "എണ്ണം",
];

function normalizeQueryText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[?!,;:()[\]{}"'’“”]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function includesAny(value: string, terms: string[]): boolean {
  return terms.some((term) => value.includes(term));
}

function extractStockProductQuery(value: string): string | null {
  let cleaned = value.normalize("NFKC");

  cleaned = cleaned
    .replace(
      /\b(?:stock|balance|available|availability|remaining|left|qty|quantity|how|many|much|is|there|what|current|please|tell|me|of|ethra|undo|bakki|aanu|aan)\b/gi,
      " ",
    )
    .replace(
      /സ്റ്റോക്ക്|എത്രയാണ്|എത്ര|ബാക്കി|ഉണ്ടോ|ഉണ്ട്|എണ്ണം|എന്താണ്|പറയാമോ|പറയൂ/g,
      " ",
    )
    .replace(/[?!,;:()[\]{}"'’“”]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return null;

  const normalized = normalizeProductDescription(cleaned);
  return normalized ? cleaned : null;
}

export function isDriverRelatedQuestion(text: string): boolean {
  const normalized = normalizeQueryText(text);
  return /\b(driver|drivers|rash?eed|rasheed|rashi|driverude|driverine)\b/.test(normalized) ||
    [
      "ഡ്രൈവർ",
      "ഡ്രൈവര്",
      "ട്രൈവർ",
      "ട്രൈവര",
      "ട്രാഇവര",
      "ട്രാവർ",
      "റഷീദ്",
      "റഷീദിനെ",
      "ഡ്രൈവറായിരുന്നു",
    ].some((term) => normalized.includes(term));
}

export function parseFastWhatsAppQuery(
  text: string,
): FastWhatsAppQuery | null {
  // Driver names and intents are resolved by semantic classification, not word position.
  if (isDriverRelatedQuestion(text)) return null;

  const normalized = normalizeQueryText(text);
  if (!normalized) return null;

  const hasBill = includesAny(normalized, BILL_TERMS);
  const hasCount = includesAny(normalized, COUNT_TERMS);

  const asksForProductMovement =
    (includesAny(normalized, PRODUCT_TERMS) || includesAny(normalized, STOCK_TERMS)) &&
    includesAny(normalized, TODAY_PRODUCT_MOVEMENT_TERMS);
  if (asksForProductMovement && includesAny(normalized, YESTERDAY_TERMS)) {
    return { type: "yesterday_products_summary" };
  }
  if (asksForProductMovement && includesAny(normalized, TODAY_TERMS)) {
    return { type: "today_products_summary" };
  }

  if (hasBill && includesAny(normalized, PENDING_TERMS)) {
    return { type: "pending_bill_count" };
  }

  if (
    hasBill &&
    hasCount &&
    includesAny(normalized, TODAY_TERMS)
  ) {
    return { type: "today_bill_count" };
  }

  if (hasBill && includesAny(normalized, LATEST_TERMS)) {
    return { type: "latest_bill" };
  }

  if (
    includesAny(normalized, TRIP_TERMS) &&
    includesAny(normalized, YESTERDAY_TERMS)
  ) {
    return { type: "yesterday_trip_summary" };
  }

  if (
    includesAny(normalized, TRIP_TERMS) &&
    includesAny(normalized, TODAY_TERMS)
  ) {
    return { type: "today_trip_summary" };
  }

  if (
    includesAny(normalized, TRIP_TERMS) &&
    includesAny(normalized, TRIP_LATEST_TERMS)
  ) {
    return { type: "latest_trip" };
  }

  const periodMatch = PERIOD_TERMS.find((entry) =>
    includesAny(normalized, entry.terms),
  );
  if (periodMatch) {
    return { type: "ops_period_summary", period: periodMatch.period };
  }

  if (
    includesAny(normalized, STOCK_TERMS) &&
    includesAny(normalized, STOCK_QUESTION_TERMS)
  ) {
    const productQuery = extractStockProductQuery(text);
    return productQuery
      ? { type: "stock_balance", productQuery }
      : { type: "stock_product_required" };
  }

  return null;
}

export function mapAiClassificationToFastQuery(
  classification: AiOperationalQueryClassification,
): FastWhatsAppQuery | null {
  if (classification.intent === "unsupported") return null;

  if (classification.intent === "stock_balance") {
    return classification.product_query
      ? { type: "stock_balance", productQuery: classification.product_query }
      : { type: "stock_product_required" };
  }

  if (classification.intent === "driver_trip_summary") {
    const driverName = classification.driver_name?.trim();
    return driverName
      ? { type: "driver_trip_summary", driverName, yesterday: classification.yesterday }
      : null;
  }

  if (classification.intent === "ops_period_summary") {
    return classification.period
      ? { type: "ops_period_summary", period: classification.period }
      : null;
  }

  return { type: classification.intent };
}

function istShift(date: Date): Date {
  return new Date(date.getTime() + IST_OFFSET_MS);
}

function fromShiftedUtc(ms: number): string {
  return new Date(ms - IST_OFFSET_MS).toISOString();
}

export function opsPeriodBounds(
  period: OpsPeriod,
  now = new Date(),
): { start: string; end: string; label: string } {
  const shifted = istShift(now);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth();
  const day = shifted.getUTCDate();
  const weekday = shifted.getUTCDay();
  const todayStart = Date.UTC(year, month, day);
  const mondayOffset = (weekday + 6) % 7;
  const thisWeekStart = todayStart - mondayOffset * 24 * 60 * 60 * 1000;

  if (period === "this_week") {
    return {
      start: fromShiftedUtc(thisWeekStart),
      end: now.toISOString(),
      label: "ഈ ആഴ്ച",
    };
  }

  if (period === "last_week") {
    return {
      start: fromShiftedUtc(thisWeekStart - 7 * 24 * 60 * 60 * 1000),
      end: fromShiftedUtc(thisWeekStart),
      label: "കഴിഞ്ഞ ആഴ്ച",
    };
  }

  const thisMonthStart = Date.UTC(year, month, 1);
  if (period === "this_month") {
    return {
      start: fromShiftedUtc(thisMonthStart),
      end: now.toISOString(),
      label: "ഈ മാസം",
    };
  }

  if (period === "last_month") {
    const lastMonthStart = Date.UTC(year, month - 1, 1);
    return {
      start: fromShiftedUtc(lastMonthStart),
      end: fromShiftedUtc(thisMonthStart),
      label: "കഴിഞ്ഞ മാസം",
    };
  }

  const thisYearStart = Date.UTC(year, 0, 1);
  if (period === "this_year") {
    return {
      start: fromShiftedUtc(thisYearStart),
      end: now.toISOString(),
      label: "ഈ വർഷം",
    };
  }

  return {
    start: fromShiftedUtc(Date.UTC(year - 1, 0, 1)),
    end: fromShiftedUtc(thisYearStart),
    label: "കഴിഞ്ഞ വർഷം",
  };
}

export function indiaDayBounds(now = new Date()): {
  start: string;
  end: string;
} {
  const shifted = new Date(now.getTime() + IST_OFFSET_MS);
  const startShiftedUtc = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
  );

  return {
    start: new Date(startShiftedUtc - IST_OFFSET_MS).toISOString(),
    end: new Date(
      startShiftedUtc + 24 * 60 * 60 * 1000 - IST_OFFSET_MS,
    ).toISOString(),
  };
}

async function activeDriverCount(): Promise<number> {
  const supabase = getSupabaseAdmin();
  const { count, error } = await supabase
    .from("ops_drivers")
    .select("id", { count: "exact", head: true })
    .eq("active", true);

  if (error) {
    throw new Error("Failed to count active drivers: " + error.message);
  }

  return count ?? 0;
}

async function todayBillCount(now = new Date()): Promise<number> {
  const supabase = getSupabaseAdmin();
  const bounds = indiaDayBounds(now);

  const { count, error } = await supabase
    .from("whatsapp_messages")
    .select("id", { count: "exact", head: true })
    .eq("message_type", "document")
    .gte("received_at", bounds.start)
    .lt("received_at", bounds.end)
    .or("mime_type.eq.application/pdf,original_filename.ilike.%.pdf");

  if (error) {
    throw new Error("Failed to count today's bills: " + error.message);
  }

  return count ?? 0;
}

async function pendingBillCount(): Promise<number> {
  const supabase = getSupabaseAdmin();
  const { count, error } = await supabase
    .from("document_drafts")
    .select("id", { count: "exact", head: true })
    .in("workflow_status", ["pending", "review_required"]);

  if (error) {
    throw new Error("Failed to count pending bills: " + error.message);
  }

  return count ?? 0;
}

async function latestBillSummary(): Promise<string> {
  const supabase = getSupabaseAdmin();
  const { data: message, error: messageError } = await supabase
    .from("whatsapp_messages")
    .select("id, original_filename, received_at")
    .eq("message_type", "document")
    .or("mime_type.eq.application/pdf,original_filename.ilike.%.pdf")
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (messageError) {
    throw new Error("Failed to load latest bill: " + messageError.message);
  }

  if (!message) {
    return "ഇതുവരെ PDF ബിൽ ലഭിച്ചിട്ടില്ല.";
  }

  const { data: draft, error: draftError } = await supabase
    .from("document_drafts")
    .select(
      "supplier_name, document_number, total_amount, workflow_status, stock_status",
    )
    .eq("message_id", message.id)
    .maybeSingle();

  if (draftError) {
    throw new Error("Failed to load latest bill details: " + draftError.message);
  }

  const lines = ["ഏറ്റവും പുതിയ ബിൽ:"];
  if (draft?.supplier_name) lines.push("കമ്പനി: " + draft.supplier_name);
  if (draft?.document_number) lines.push("ബിൽ നമ്പർ: " + draft.document_number);
  if (!draft?.document_number && message.original_filename) {
    lines.push("ഫയൽ: " + message.original_filename);
  }
  if (draft?.total_amount !== null && draft?.total_amount !== undefined) {
    lines.push(
      "ആകെ: " +
        new Intl.NumberFormat("en-IN", {
          style: "currency",
          currency: "INR",
          maximumFractionDigits: 2,
        }).format(Number(draft.total_amount)),
    );
  }
  if (draft?.workflow_status) {
    lines.push("നില: " + draft.workflow_status.replaceAll("_", " "));
  }
  if (draft?.stock_status) {
    lines.push("സ്റ്റോക്ക്: " + draft.stock_status.replaceAll("_", " "));
  }

  return lines.join("\n");
}

type StockMatch = {
  product_id: string;
  company_id: string;
  company_name: string;
  product_name: string;
  unit: string;
  current_quantity: number;
  balance_known: boolean;
};

export type FuzzyStockCandidate = {
  product_id: string;
  matched_name: string;
  similarity_score: number;
};

function numericTokens(value: string): string[] {
  return normalizeProductDescription(value)
    .split(" ")
    .filter((token) => /^\d+(?:\.\d+)?$/.test(token))
    .sort();
}

export function filterSafeFuzzyStockCandidates(
  productQuery: string,
  candidates: FuzzyStockCandidate[],
): FuzzyStockCandidate[] {
  const queryNumbers = numericTokens(productQuery);

  return candidates
    .filter((candidate) => {
      if (
        !Number.isFinite(candidate.similarity_score) ||
        candidate.similarity_score < MIN_FUZZY_STOCK_SCORE
      ) {
        return false;
      }

      if (queryNumbers.length === 0) return true;

      const candidateNumbers = numericTokens(candidate.matched_name);
      return queryNumbers.every((token) => candidateNumbers.includes(token));
    })
    .sort(
      (left, right) =>
        right.similarity_score - left.similarity_score ||
        left.matched_name.localeCompare(right.matched_name),
    )
    .slice(0, MAX_STOCK_MATCHES);
}

async function fuzzyStockProductIds(
  productQuery: string,
): Promise<string[]> {
  const normalized = normalizeProductDescription(productQuery);
  if (!normalized) return [];

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc(
    "search_stock_product_candidates",
    {
      p_query: normalized,
      p_limit: MAX_STOCK_MATCHES,
    },
  );

  if (error) {
    throw new Error("Failed to search stock products: " + error.message);
  }

  const candidates = (data ?? []).map(
    (row: {
      product_id: unknown;
      matched_name: unknown;
      similarity_score: unknown;
    }) => ({
      product_id: String(row.product_id),
      matched_name: String(row.matched_name ?? ""),
      similarity_score: Number(row.similarity_score),
    }),
  ) as FuzzyStockCandidate[];

  return Array.from(
    new Set(
      filterSafeFuzzyStockCandidates(productQuery, candidates).map(
        (candidate) => candidate.product_id,
      ),
    ),
  ).slice(0, MAX_STOCK_MATCHES);
}

function formatStockMatches(
  matches: StockMatch[],
  fuzzy: boolean,
): string {
  if (matches.length === 0) {
    return "ഈ സാധനം കണ്ടെത്തി, പക്ഷേ നിലവിലെ stock balance ലഭിച്ചില്ല.";
  }

  if (matches.length === 1) {
    const item = matches[0];
    return [
      fuzzy ? "Match ചെയ്തത്: " + item.product_name : item.product_name,
      "കമ്പനി: " + item.company_name,
      item.balance_known
        ? "സ്റ്റോക്ക്: " +
          String(item.current_quantity) +
          (item.unit ? " " + item.unit : "")
        : "സ്റ്റോക്ക്: count ഇനിയും add ചെയ്തിട്ടില്ല.",
    ].join("\n");
  }

  return [
    fuzzy
      ? "നിങ്ങൾ എഴുതിയത് ഒന്നിലധികം stock entries-നോട് match ചെയ്യുന്നു:"
      : "ഒരേ പേരിലുള്ള stock ഒന്നിലധികം കമ്പനികളിലുണ്ട്:",
    ...matches.map(
      (item) =>
        "• " +
        item.company_name +
        " — " +
        item.product_name +
        ": " +
        (item.balance_known
          ? String(item.current_quantity) + (item.unit ? " " + item.unit : "")
          : "count add ചെയ്തിട്ടില്ല"),
    ),
    fuzzy
      ? "Model/number അല്ലെങ്കിൽ പേരിലെ മറ്റൊരു ഭാഗം കൂടി അയച്ചാൽ ഞാൻ narrow ചെയ്യാം."
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function stockBalanceAnswer(productQuery: string): Promise<string> {
  const normalized = normalizeProductDescription(productQuery);
  if (!normalized) {
    return "ഏത് സാധനത്തിന്റെ സ്റ്റോക്കാണെന്ന് പേര് കൂടി അയക്കൂ.";
  }

  const supabase = getSupabaseAdmin();
  const [canonicalResult, aliasResult] = await Promise.all([
    supabase
      .from("stock_products")
      .select("id")
      .eq("normalized_name", normalized)
      .eq("active", true)
      .limit(MAX_STOCK_MATCHES),
    supabase
      .from("stock_product_aliases")
      .select("product_id")
      .eq("normalized_alias", normalized)
      .limit(MAX_STOCK_MATCHES),
  ]);

  if (canonicalResult.error) {
    throw new Error(
      "Failed to resolve stock product: " + canonicalResult.error.message,
    );
  }
  if (aliasResult.error) {
    throw new Error(
      "Failed to resolve stock product alias: " + aliasResult.error.message,
    );
  }

  let productIds = Array.from(
    new Set([
      ...(canonicalResult.data ?? []).map((row) => row.id),
      ...(aliasResult.data ?? []).map((row) => row.product_id),
    ]),
  ).slice(0, MAX_STOCK_MATCHES);
  let fuzzy = false;

  if (productIds.length === 0) {
    productIds = await fuzzyStockProductIds(productQuery);
    fuzzy = productIds.length > 0;
  }

  if (productIds.length === 0) {
    return (
      "“" +
      productQuery.trim().slice(0, 80) +
      "” എന്നതുമായി സുരക്ഷിതമായി match ചെയ്യുന്ന stock item കണ്ടെത്തിയില്ല. " +
      "Model/number അല്ലെങ്കിൽ പേരിലെ മറ്റൊരു ഭാഗം കൂടി അയക്കൂ."
    );
  }

  const { data, error } = await supabase
    .from("stock_balances")
    .select(
      "product_id, company_id, company_name, product_name, unit, current_quantity, balance_known",
    )
    .in("product_id", productIds)
    .limit(MAX_STOCK_MATCHES);

  if (error) {
    throw new Error("Failed to load stock balance: " + error.message);
  }

  const matches = (data ?? [])
    .map((row) => ({
      product_id: row.product_id,
      company_id: row.company_id,
      company_name: row.company_name,
      product_name: row.product_name,
      unit: row.unit,
      current_quantity: Number(row.current_quantity),
      balance_known: Boolean(row.balance_known),
    }))
    .sort(
      (left, right) =>
        productIds.indexOf(left.product_id) - productIds.indexOf(right.product_id),
    ) as StockMatch[];

  return formatStockMatches(matches, fuzzy);
}

type TripSummaryRow = {
  display_name: string | null;
  vehicle_number: string | null;
  driver_id: string | null;
  finalized_at: string | null;
};

async function driverNamesById(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("ops_drivers")
    .select("id, name")
    .in("id", Array.from(new Set(ids)));

  if (error) {
    throw new Error("Failed to load trip drivers: " + error.message);
  }

  return new Map((data ?? []).map((row) => [row.id, row.name]));
}

function formatTripSummary(
  rows: TripSummaryRow[],
  driverNames: Map<string, string>,
  heading: string,
): string {
  if (rows.length === 0) return heading + "\nCompleted trip ഒന്നുമില്ല.";

  return [
    heading,
    ...rows.map((trip, index) => {
      const parts = [
        String(index + 1) + ". " + (trip.display_name ?? "Trip"),
        trip.driver_id ? driverNames.get(trip.driver_id) ?? null : null,
        trip.vehicle_number ?? null,
      ].filter((part): part is string => Boolean(part));
      return parts.join(" · ");
    }),
  ].join("\n");
}

async function driverTripsSummary(
  driverName: string,
  yesterday = false,
  now = new Date(),
): Promise<string> {
  const supabase = getSupabaseAdmin();
  const queryTime = yesterday ? new Date(now.getTime() - 24 * 60 * 60 * 1000) : now;
  const bounds = indiaDayBounds(queryTime);
  const { data: drivers, error: driverError } = await supabase
    .from("ops_drivers")
    .select("id, name");
  if (driverError) throw new Error("Failed to load driver directory: " + driverError.message);
  const normalizedTarget = driverName.normalize("NFKC").toLocaleLowerCase("en").replace(/[^\p{L}\p{N}]/gu, "");
  const matched = (drivers ?? []).filter((driver) => {
    const name = String(driver.name ?? "").normalize("NFKC").toLocaleLowerCase("en").replace(/[^\p{L}\p{N}]/gu, "");
    return name === normalizedTarget || name.includes(normalizedTarget) || normalizedTarget.includes(name);
  });
  if (matched.length !== 1) {
    return matched.length === 0
      ? "Driver directory-ൽ “" + driverName + "” എന്ന പേര് കൃത്യമായി കണ്ടെത്താനായില്ല. പേര് confirm ചെയ്യൂ."
      : "“" + driverName + "” എന്ന പേരിൽ ഒന്നിലധികം drivers ഉണ്ട്. കൃത്യമായ പേര് തിരഞ്ഞെടുക്കൂ.";
  }
  const driver = matched[0];
  const { data: trips, error } = await supabase
    .from("delivery_trips")
    .select("display_name, vehicle_number, driver_id, finalized_at")
    .eq("status", "ready")
    .eq("driver_id", driver.id)
    .gte("finalized_at", bounds.start)
    .lt("finalized_at", bounds.end)
    .order("finalized_at", { ascending: false })
    .limit(50);
  if (error) throw new Error("Failed to load driver trips: " + error.message);
  const rows = (trips ?? []) as TripSummaryRow[];
  const names = await driverNamesById(rows.map((row) => row.driver_id).filter((id): id is string => Boolean(id)));
  return rows.length === 0
    ? (yesterday ? "ഇന്നലെ " : "ഇന്ന് ") + driverName + " എന്ന driver-ന്റെ finalized trip കണ്ടെത്തിയില്ല."
    : formatTripSummary(rows, names, (yesterday ? "ഇന്നലത്തെ " : "ഇന്നത്തെ ") + driverName + "യുടെ trips (ആകെ " + String(rows.length) + "):");
}

async function tripsSummaryForDay(
  yesterday = false,
  now = new Date(),
): Promise<string> {
  const supabase = getSupabaseAdmin();
  const queryTime = yesterday ? new Date(now.getTime() - 24 * 60 * 60 * 1000) : now;
  const bounds = indiaDayBounds(queryTime);
  const dayLabel = yesterday ? "ഇന്നലത്തെ" : "ഇന്നത്തെ";
  const { data, error } = await supabase
    .from("delivery_trips")
    .select("display_name, vehicle_number, driver_id, finalized_at")
    .eq("status", "ready")
    .gte("finalized_at", bounds.start)
    .lt("finalized_at", bounds.end)
    .order("finalized_at", { ascending: false })
    .limit(8);

  if (error) {
    throw new Error("Failed to load today's trips: " + error.message);
  }

  const rows = (data ?? []) as TripSummaryRow[];
  const names = await driverNamesById(
    rows.map((row) => row.driver_id).filter((id): id is string => Boolean(id)),
  );
  return formatTripSummary(rows, names, dayLabel + " completed trips (ആകെ " + String(rows.length) + "):");
}

async function productsSummaryForDay(
  yesterday = false,
  now = new Date(),
): Promise<string> {
  const supabase = getSupabaseAdmin();
  const queryTime = yesterday ? new Date(now.getTime() - 24 * 60 * 60 * 1000) : now;
  const bounds = indiaDayBounds(queryTime);
  const dayLabel = yesterday ? "ഇന്നലെ" : "ഇന്ന്";
  const { data: trips, error: tripsError } = await supabase
    .from("delivery_trips")
    .select("id")
    .eq("status", "ready")
    .gte("finalized_at", bounds.start)
    .lt("finalized_at", bounds.end)
    .limit(50);

  if (tripsError) {
    throw new Error(
      "Failed to load today's completed trips: " + tripsError.message,
    );
  }

  const tripIds = (trips ?? []).map((trip) => trip.id);
  if (tripIds.length === 0) {
    return dayLabel + " completed trip രേഖപ്പെടുത്തിയിട്ടില്ല.";
  }

  const { data: tripDocuments, error: tripDocumentsError } = await supabase
    .from("trip_documents")
    .select("draft_id")
    .in("trip_id", tripIds)
    .not("draft_id", "is", null);

  if (tripDocumentsError) {
    throw new Error(
      "Failed to load today's trip bills: " + tripDocumentsError.message,
    );
  }

  const draftIds = Array.from(
    new Set(
      (tripDocuments ?? [])
        .map((row) => row.draft_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  if (draftIds.length === 0) {
    return dayLabel + " completed trips-ൽ linked bill details ലഭ്യമല്ല.";
  }

  const { data: drafts, error: draftsError } = await supabase
    .from("document_drafts")
    .select("id, workflow_status, stock_status")
    .in("id", draftIds);

  if (draftsError) {
    throw new Error(
      "Failed to load today's trip bill status: " + draftsError.message,
    );
  }

  const draftRows = drafts ?? [];
  const confirmedDraftIds = draftRows
    .filter(
      (draft) =>
        draft.workflow_status === "recorded" &&
        draft.stock_status !== "duplicate_document",
    )
    .map((draft) => draft.id);
  const needsReviewCount = draftRows.filter(
    (draft) =>
      draft.workflow_status === "review_required" ||
      draft.workflow_status === "pending",
  ).length;

  if (confirmedDraftIds.length === 0) {
    return [
      dayLabel + " പോയ products: സ്ഥിരീകരിച്ച bill items കണ്ടെത്തിയില്ല.",
      needsReviewCount > 0
        ? "⚠️ " + needsReviewCount + " bill(s) review/pending ആണ്; അതിനാൽ product total-ൽ ഉൾപ്പെടുത്തിയിട്ടില്ല."
        : null,
    ].filter((line): line is string => Boolean(line)).join("\n");
  }

  const { data: items, error: itemsError } = await supabase
    .from("document_items")
    .select("id, draft_id, description, hsn_sac, quantity, unit")
    .in("draft_id", confirmedDraftIds)
    .order("draft_id", { ascending: true })
    .order("line_index", { ascending: true });

  if (itemsError) {
    throw new Error(
      "Failed to load today's trip product items: " + itemsError.message,
    );
  }

  const combined = new Map<
    string,
    { description: string; quantity: number | null; unit: string | null }
  >();
  for (const item of items ?? []) {
    const description = String(item.description ?? "")
      .normalize("NFKC")
      .replace(/\s+/g, " ")
      .trim();
    if (!description) continue;
    const hsn = String(item.hsn_sac ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    const unit = String(item.unit ?? "").normalize("NFKC").trim();
    const normalizedDescription = description
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
    const keyBase = [normalizedDescription, hsn, unit.toLowerCase()].join("|");
    const rawQuantity = item.quantity;
    const quantity =
      rawQuantity !== null && rawQuantity !== undefined && Number.isFinite(Number(rawQuantity))
        ? Number(rawQuantity)
        : null;
    const key = quantity === null ? keyBase + "|unknown|" + String(item.id) : keyBase;
    const existing = combined.get(key);
    if (existing && existing.quantity !== null && quantity !== null) {
      existing.quantity += quantity;
    } else {
      combined.set(key, { description, quantity, unit: unit || null });
    }
  }

  const lines = [...combined.values()];
  const knownTotalQuantity = lines.reduce(
    (total, item) => total + (item.quantity ?? 0),
    0,
  );
  const allQuantitiesKnown = lines.length > 0 && lines.every((item) => item.quantity !== null);
  const formatQuantity = (quantity: number | null) =>
    quantity === null
      ? "qty ?"
      : Number.isInteger(quantity)
        ? String(quantity)
        : String(Number(quantity.toFixed(3)));
  return [
    dayLabel + " പോയ products (recorded bills):",
    "വ്യത്യസ്ത product lines: " + String(lines.length),
    allQuantitiesKnown
      ? "ആകെ quantity: " + formatQuantity(knownTotalQuantity)
      : "ആകെ quantity: പൂർണ്ണമായി കണക്കാക്കാൻ കഴിയില്ല (ചില item quantity ലഭ്യമല്ല).",
    ...(lines.length === 0
      ? ["Confirmed bill-ൽ product item details ലഭ്യമല്ല."]
      : lines.slice(0, 10).map(
          (item) =>
            "• " +
            item.description.slice(0, 64) +
            " — " +
            formatQuantity(item.quantity) +
            (item.unit ? " " + item.unit : ""),
        )),
    ...(lines.length > 10 ? ["+ " + String(lines.length - 10) + " more products"] : []),
    ...(needsReviewCount > 0
      ? ["⚠️ " + needsReviewCount + " bill(s) review/pending ആണ്; product total-ൽ ഉൾപ്പെടുത്തിയിട്ടില്ല."]
      : []),
  ].join("\n");
}

async function latestTripSummary(): Promise<string> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("delivery_trips")
    .select("display_name, vehicle_number, driver_id, finalized_at")
    .eq("status", "ready")
    .order("finalized_at", { ascending: false })
    .limit(1);

  if (error) {
    throw new Error("Failed to load latest trip: " + error.message);
  }

  const rows = (data ?? []) as TripSummaryRow[];
  const names = await driverNamesById(
    rows.map((row) => row.driver_id).filter((id): id is string => Boolean(id)),
  );
  return formatTripSummary(rows, names, "Latest saved trip:");
}

async function operationalPeriodSummary(
  period: OpsPeriod,
): Promise<string> {
  const supabase = getSupabaseAdmin();
  const bounds = opsPeriodBounds(period);

  const { data, error } = await supabase.rpc("get_ops_period_summary", {
    p_start: bounds.start,
    p_end: bounds.end,
  });

  if (error) {
    throw new Error("Failed to load operational period summary: " + error.message);
  }

  const row = Array.isArray(data) ? data[0] : data;
  return [
    bounds.label + " summary:",
    "Bills: " + String(Number(row?.bill_count ?? 0)),
    "Verified: " + String(Number(row?.verified_bill_count ?? 0)),
    "Needs review: " + String(Number(row?.review_bill_count ?? 0)),
    "Ready trips: " + String(Number(row?.completed_trip_count ?? 0)),
  ].join("\n");
}

async function answerFastQuery(
  query: FastWhatsAppQuery,
): Promise<string> {
  if (query.type === "driver_count") {
    const count = await activeDriverCount();
    return "നിലവിൽ active ആയ ഡ്രൈവർമാർ: " + String(count) + ".";
  }

  if (query.type === "today_bill_count") {
    const count = await todayBillCount();
    return "ഇന്ന് ലഭിച്ച PDF ബില്ലുകൾ: " + String(count) + ".";
  }

  if (query.type === "pending_bill_count") {
    const count = await pendingBillCount();
    return "പരിശോധിക്കാനുള്ള ബില്ലുകൾ: " + String(count) + ".";
  }

  if (query.type === "latest_bill") {
    return latestBillSummary();
  }

  if (query.type === "stock_product_required") {
    return "ഏത് സാധനത്തിന്റെ സ്റ്റോക്കാണെന്ന് product name കൂടി അയക്കൂ.";
  }

  if (query.type === "today_trip_summary") {
    return tripsSummaryForDay(false);
  }

  if (query.type === "yesterday_trip_summary") {
    return tripsSummaryForDay(true);
  }

  if (query.type === "driver_trip_summary") {
    return driverTripsSummary(query.driverName, query.yesterday);
  }

  if (query.type === "today_products_summary") {
    return productsSummaryForDay(false);
  }

  if (query.type === "yesterday_products_summary") {
    return productsSummaryForDay(true);
  }

  if (query.type === "latest_trip") {
    return latestTripSummary();
  }

  if (query.type === "ops_period_summary") {
    return operationalPeriodSummary(query.period);
  }

  return stockBalanceAnswer(query.productQuery);
}

export async function handleFastWhatsAppQuery(
  message: NormalizedWhatsAppMessage,
  storedMessageId: string,
  options: { fromVoice?: boolean } = {},
): Promise<"handled" | "ignored"> {
  if (message.type !== "text" || !message.textBody) return "ignored";

  const startedAt = performance.now();
  let resolver: "deterministic" | "ai_intent" | "ai_fallback" | "fixed_fallback" =
    "deterministic";
  // Resolve driver questions semantically; positional name regexes can mistake question/date words for a driver name.
  let query = isDriverRelatedQuestion(message.textBody)
    ? null
    : parseFastWhatsAppQuery(message.textBody);
  const driverQuestion = !query && isDriverRelatedQuestion(message.textBody);
  const likelyOperational = !query && !driverQuestion && looksLikeOperationalQuery(message.textBody);
  let classificationReply: string | null = null;
  let operationalClassifierFailed = false;
  let classifierOutcome: "not_attempted" | "no_result" | "mapped" | "unsupported" | "failed" =
    "not_attempted";
  let classifierDurationMs = 0;

  if (!query) {
    classifierOutcome = "no_result";
    const classifierStartedAt = performance.now();
    try {
      const classification = await classifyOperationalQueryWithGroq(
        message.textBody,
      );
      if (classification) {
        classifierOutcome = classification.intent === "unsupported" ? "unsupported" : "mapped";
        query = mapAiClassificationToFastQuery(classification);
        if (query) resolver = "ai_intent";
        else classificationReply = classification.reply;
      }
    } catch (error) {
      operationalClassifierFailed = true;
      classifierOutcome = "failed";
      console.warn("WhatsApp operational intent classification failed", {
        reason:
          error instanceof Error
            ? error.message.slice(0, 180)
            : "Unknown classification error",
      });
    } finally {
      classifierDurationMs = Math.round(performance.now() - classifierStartedAt);
    }
  }

  const lookupStartedAt = performance.now();
  let body: string;

  if (query) {
    body = await answerFastQuery(query);
  } else if (driverQuestion) {
    resolver = "fixed_fallback";
    body = "ഏത് driver-ന്റെ trips ആണ് വേണ്ടത്? Driver-ന്റെ പേര്, ഇന്ന്/ഇന്നലെ എന്ന് അയക്കൂ.";
  } else if (options.fromVoice) {
    resolver = "fixed_fallback";
    body = voiceQueryClarification(message.textBody);
  } else if (classificationReply) {
    resolver = "ai_fallback";
    body = classificationReply;
  } else if (likelyOperational) {
    resolver = "fixed_fallback";
    body = fixedOperationalFallback();

    if (operationalClassifierFailed) {
      console.info("Operational fallback used after classifier failure");
    }
  } else if (
    classifierOutcome === "failed" ||
    classifierOutcome === "unsupported" ||
    classifierOutcome === "mapped"
  ) {
    resolver = "fixed_fallback";
    body = fixedUniversalFallback(message.textBody);
  } else {
    resolver = "ai_fallback";
    try {
      body =
        (await generateUniversalWhatsAppReply(message.textBody)) ??
        fixedUniversalFallback(message.textBody);
    } catch (error) {
      resolver = "fixed_fallback";
      console.warn("Universal WhatsApp fallback reply failed", {
        reason:
          error instanceof Error
            ? error.message.slice(0, 180)
            : "Unknown fallback error",
      });
      body = fixedUniversalFallback(message.textBody);
    }
  }

  const lookupDurationMs = Math.round(performance.now() - lookupStartedAt);

  const sendStartedAt = performance.now();
  await sendOpsReply({
    requestId: deterministicUuid("fast-query:" + message.messageId),
    replyToMessageId: storedMessageId,
    body,
    knownInboundAt: message.timestamp,
  });
  const sendDurationMs = Math.round(performance.now() - sendStartedAt);

  console.info("Fast WhatsApp operational query completed", {
    correlationId: storedMessageId,
    sourceMessageId: message.messageId,
    inputType: options.fromVoice ? "voice_transcript" : "text",
    inputChars: message.textBody.length,
    intent: query?.type ?? "universal_fallback",
    driverFilterApplied: query?.type === "driver_trip_summary",
    driverNameExtracted: query?.type === "driver_trip_summary" ? query.driverName : null,
    dateFilter: query?.type === "driver_trip_summary"
      ? query.yesterday ? "yesterday" : "today"
      : query?.type === "today_trip_summary" ? "today"
      : query?.type === "yesterday_trip_summary" ? "yesterday" : null,
    resolver,
    likelyOperational,
    deterministicMatch: resolver === "deterministic",
    classifierOutcome,
    classifierDurationMs,
    lookupDurationMs,
    sendDurationMs,
    durationMs: Math.round(performance.now() - startedAt),
  });

  return "handled";
}
