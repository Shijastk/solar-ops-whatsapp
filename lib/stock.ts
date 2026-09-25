import { z } from "zod";
import { normalizeProductDescription } from "@/lib/document-parser";
import { deterministicUuid } from "@/lib/idempotency";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

const quantitySchema = z.coerce.number().finite().positive().max(1_000_000_000);
const stockTargetQuantitySchema = z.coerce
  .number()
  .finite()
  .min(0)
  .max(1_000_000_000);

const stockResultSchema = z.object({
  status: z.enum([
    "applied",
    "already_applied",
    "company_unmapped",
    "needs_product_match",
    "insufficient_stock",
    "invalid_item",
    "not_ready",
    "inconsistent",
    "reversed",
    "already_reversed",
    "corrected",
    "already_corrected",
    "alias_saved",
    "alias_exists",
    "alias_conflict",
    "company_alias_saved",
    "company_alias_exists",
    "company_alias_conflict",
    "opening_created",
    "opening_exists",
    "potential_company_duplicate",
    "potential_product_duplicate",
  ]),
  draft_id: z.string().uuid().optional(),
  company_id: z.string().uuid().optional(),
  item_id: z.string().uuid().optional(),
  product_id: z.string().uuid().optional(),
  product_name: z.string().optional(),
  description: z.string().optional(),
  unit: z.string().nullable().optional(),
  available: z.coerce.number().optional(),
  required: z.coerce.number().optional(),
  reason: z.string().optional(),
});

const companySchema = z.object({
  id: z.string().uuid(),
  canonical_name: z.string(),
  gstin: z.string().nullable(),
});

const productSchema = z.object({
  id: z.string().uuid(),
  company_id: z.string().uuid(),
  canonical_name: z.string(),
  unit: z.string(),
  hsn_sac: z.string().nullable(),
});

const balanceSchema = z.object({
  product_id: z.string().uuid(),
  company_id: z.string().uuid(),
  company_name: z.string(),
  company_gstin: z.string().nullable(),
  product_name: z.string(),
  unit: z.string(),
  hsn_sac: z.string().nullable(),
  current_quantity: z.coerce.number(),
});

export type StockResult = z.infer<typeof stockResultSchema>;
export type StockCompany = z.infer<typeof companySchema>;
export type StockProduct = z.infer<typeof productSchema>;
export type StockBalance = z.infer<typeof balanceSchema>;

const stockAdjustmentResultSchema = z.object({
  status: z.enum([
    "adjusted",
    "already_adjusted",
    "no_change",
    "not_ready",
    "inconsistent",
  ]),
  product_id: z.string().uuid().optional(),
  product_name: z.string().optional(),
  previous_quantity: z.coerce.number().optional(),
  target_quantity: z.coerce.number().optional(),
});

export type StockAdjustmentResult = z.infer<typeof stockAdjustmentResultSchema>;

export function normalizeStockName(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeStockUnit(value: string): string {
  return value
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;
const GSTIN_TOKEN_PATTERN =
  /[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]/g;

export function normalizeStockGstin(value: string): string {
  const normalizedText = value.normalize("NFKC").toUpperCase();
  const compact = normalizedText.replace(/[^A-Z0-9]/g, "");

  if (GSTIN_PATTERN.test(compact)) {
    return compact;
  }

  const candidates = normalizedText.match(GSTIN_TOKEN_PATTERN) ?? [];
  const uniqueCandidates = [...new Set(candidates)];

  return uniqueCandidates.length === 1 ? uniqueCandidates[0] : compact;
}

export function validateOpeningStockInput(input: {
  companyId?: string | null;
  companyName?: string | null;
  companyGstin?: string | null;
  productName: string;
  unit: string;
  hsnSac?: string | null;
  quantity: number | string;
  allowSimilarCompany?: boolean;
  allowSimilarProduct?: boolean;
}) {
  const companyId = input.companyId?.trim() || null;
  const companyName = input.companyName?.trim() || null;
  const companyGstin = input.companyGstin
    ? normalizeStockGstin(input.companyGstin) || null
    : null;
  const productName = input.productName.trim();
  const unit = input.unit.trim().toUpperCase();
  const hsnSac = input.hsnSac?.trim() || null;
  const quantity = quantitySchema.parse(input.quantity);

  if (!companyId && !companyName) {
    throw new Error("Select an existing company or enter a new company name");
  }
  if (companyId && !z.string().uuid().safeParse(companyId).success) {
    throw new Error("Invalid company");
  }
  if (companyName && companyName.length > 160) {
    throw new Error("Company name is too long");
  }
  if (!companyId && !companyGstin) {
    throw new Error("GSTIN is required for a new company");
  }
  if (companyGstin && !GSTIN_PATTERN.test(companyGstin)) {
    throw new Error("GSTIN must match the standard 15-character GSTIN format");
  }
  if (!productName || productName.length > 200) {
    throw new Error("Product name is required");
  }
  if (!unit || unit.length > 24 || !/^[A-Z0-9 /._-]+$/.test(unit)) {
    throw new Error("Unit is invalid");
  }
  if (hsnSac && !/^[A-Za-z0-9./ -]{1,32}$/.test(hsnSac)) {
    throw new Error("HSN/SAC is invalid");
  }

  return {
    companyId,
    companyName,
    companyGstin,
    companyNormalized: companyName ? normalizeStockName(companyName) : null,
    productName,
    productNormalized: normalizeProductDescription(productName),
    unit,
    unitNormalized: normalizeStockUnit(unit),
    hsnSac,
    quantity,
    allowSimilarCompany: Boolean(input.allowSimilarCompany),
    allowSimilarProduct: Boolean(input.allowSimilarProduct),
  };
}

export function validateStockAdjustmentInput(input: {
  productId: string;
  targetQuantity: number | string;
}) {
  const productId = z.string().uuid().parse(input.productId);
  const targetQuantity = stockTargetQuantitySchema.parse(input.targetQuantity);

  return {
    productId,
    targetQuantity,
  };
}

export async function adjustStockBalance(input: {
  productId: string;
  targetQuantity: number | string;
  actionKey: string;
}): Promise<StockAdjustmentResult> {
  const parsed = validateStockAdjustmentInput(input);
  const actionKey = z.string().uuid().parse(input.actionKey);
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase.rpc("adjust_stock_balance", {
    p_product_id: parsed.productId,
    p_target_quantity: parsed.targetQuantity,
    p_idempotency_key: actionKey,
  });

  if (error) {
    throw new Error("Failed to adjust stock: " + error.message);
  }

  return stockAdjustmentResultSchema.parse(data);
}

export async function createOpeningStock(input: {
  companyId?: string | null;
  companyName?: string | null;
  companyGstin?: string | null;
  productName: string;
  unit: string;
  hsnSac?: string | null;
  quantity: number | string;
  allowSimilarCompany?: boolean;
  allowSimilarProduct?: boolean;
}): Promise<StockResult> {
  const parsed = validateOpeningStockInput(input);
  const supabase = getSupabaseAdmin();

  const companies = await listStockCompanies();
  let resolvedCompanyId = parsed.companyId;

  if (parsed.companyId) {
    const selectedCompany = companies.find(
      (company) => company.id === parsed.companyId,
    );

    if (!selectedCompany) {
      throw new Error("Selected company was not found");
    }

    if (!selectedCompany.gstin) {
      throw new Error("Selected company must have a GSTIN before adding stock");
    }

    if (
      parsed.companyGstin &&
      selectedCompany.gstin !== parsed.companyGstin
    ) {
      throw new Error("Selected company GSTIN does not match");
    }
  }

  if (!resolvedCompanyId && parsed.companyGstin) {
    resolvedCompanyId =
      companies.find((company) => company.gstin === parsed.companyGstin)?.id ??
      null;
  }

  if (!resolvedCompanyId && parsed.companyNormalized) {
    resolvedCompanyId =
      companies.find(
        (company) =>
          normalizeStockName(company.canonical_name) ===
          parsed.companyNormalized,
      )?.id ?? null;
  }

  if (
    !resolvedCompanyId &&
    parsed.companyName &&
    !parsed.allowSimilarCompany
  ) {
    const target = tokenSet(parsed.companyName);
    const similar = companies
      .map((company) => ({
        company,
        score: similarityScore(target, tokenSet(company.canonical_name)),
      }))
      .filter((entry) => entry.score >= 0.78)
      .sort((left, right) => right.score - left.score)[0];

    if (similar) {
      return stockResultSchema.parse({
        status: "potential_company_duplicate",
        company_id: similar.company.id,
        company_name: similar.company.canonical_name,
      });
    }
  }

  if (resolvedCompanyId && !parsed.allowSimilarProduct) {
    const normalizedUnit = parsed.unitNormalized;
    const { data: existingData, error: existingError } = await supabase
      .from("stock_products")
      .select("id, company_id, canonical_name, unit, hsn_sac")
      .eq("company_id", resolvedCompanyId)
      .eq("normalized_unit", normalizedUnit)
      .eq("active", true)
      .limit(100);

    if (existingError) {
      throw new Error(
        "Failed to validate opening stock product identity: " +
          existingError.message,
      );
    }

    const existingProducts = z.array(productSchema).parse(existingData ?? []);
    const targetTokens = tokenSet(parsed.productName);
    const targetNumbers = numericTokens(targetTokens);

    const potential = existingProducts
      .filter(
        (product) =>
          normalizeProductDescription(product.canonical_name) !==
          parsed.productNormalized,
      )
      .map((product) => {
        const productTokens = tokenSet(product.canonical_name);
        const sameNumbers =
          equalStringArrays(targetNumbers, numericTokens(productTokens));
        const sameHsn =
          Boolean(parsed.hsnSac) &&
          Boolean(product.hsn_sac) &&
          normalizeIdentifier(parsed.hsnSac ?? "") ===
            normalizeIdentifier(product.hsn_sac ?? "");

        return {
          product,
          score: similarityScore(targetTokens, productTokens),
          sameNumbers,
          sameHsn,
        };
      })
      .filter(
        (entry) =>
          entry.sameHsn ||
          (entry.sameNumbers && entry.score >= 0.72) ||
          entry.score >= 0.88,
      )
      .sort((left, right) => right.score - left.score)[0];

    if (potential) {
      return stockResultSchema.parse({
        status: "potential_product_duplicate",
        company_id: resolvedCompanyId,
        product_id: potential.product.id,
        product_name: potential.product.canonical_name,
      });
    }
  }

  const { data, error } = await supabase.rpc("create_opening_stock", {
    p_company_id: parsed.companyId,
    p_company_name: parsed.companyName,
    p_company_normalized: parsed.companyNormalized,
    p_company_gstin: parsed.companyGstin,
    p_product_name: parsed.productName,
    p_product_normalized: parsed.productNormalized,
    p_unit: parsed.unit,
    p_unit_normalized: parsed.unitNormalized,
    p_hsn_sac: parsed.hsnSac,
    p_quantity: parsed.quantity,
    p_idempotency_key: deterministicUuid(
      [
        "opening-stock",
        parsed.companyId ?? parsed.companyNormalized ?? "",
        parsed.productNormalized,
        parsed.unitNormalized,
      ].join(":"),
    ),
  });

  if (error) {
    throw new Error("Failed to create opening stock: " + error.message);
  }

  return stockResultSchema.parse(data);
}

export async function listStockCompanies(): Promise<StockCompany[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("stock_companies")
    .select("id, canonical_name, gstin")
    .eq("active", true)
    .order("canonical_name", { ascending: true });

  if (error) {
    throw new Error("Failed to load stock companies: " + error.message);
  }

  return z.array(companySchema).parse(data ?? []);
}

export async function listStockBalances(): Promise<StockBalance[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("stock_balances")
    .select(
      "product_id, company_id, company_name, company_gstin, product_name, unit, hsn_sac, current_quantity",
    )
    .order("company_name", { ascending: true })
    .order("product_name", { ascending: true });

  if (error) {
    throw new Error("Failed to load stock balances: " + error.message);
  }

  return z.array(balanceSchema).parse(data ?? []);
}

export async function applyStockOutForDraft(
  draftId: string,
): Promise<StockResult> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("apply_stock_out_for_draft", {
    p_draft_id: draftId,
  });

  if (error) {
    throw new Error("Failed to apply stock out: " + error.message);
  }

  return stockResultSchema.parse(data);
}

export async function reverseStockForDraft(
  draftId: string,
): Promise<StockResult> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("reverse_stock_for_draft", {
    p_draft_id: draftId,
  });

  if (error) {
    throw new Error("Failed to reverse stock for document: " + error.message);
  }

  return stockResultSchema.parse(data);
}

export async function applyStockQuantityCorrection(input: {
  draftId: string;
  itemId: string;
  quantity: number;
  actionKey: string;
}): Promise<StockResult> {
  const quantity = quantitySchema.parse(input.quantity);
  const actionKey = z.string().uuid().parse(input.actionKey);
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase.rpc(
    "apply_stock_quantity_correction",
    {
      p_draft_id: input.draftId,
      p_item_id: input.itemId,
      p_new_quantity: quantity,
      p_action_key: actionKey,
    },
  );

  if (error) {
    throw new Error("Failed to correct stock quantity: " + error.message);
  }

  return stockResultSchema.parse(data);
}

export async function saveCompanyAlias(input: {
  draftId: string;
  companyId: string;
}): Promise<StockResult> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("map_stock_company_alias", {
    p_draft_id: input.draftId,
    p_company_id: input.companyId,
  });

  if (error) {
    throw new Error("Failed to save company mapping: " + error.message);
  }

  return stockResultSchema.parse(data);
}

export async function saveProductAlias(input: {
  draftId: string;
  itemId: string;
  productId: string;
}): Promise<StockResult> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("map_stock_product_alias", {
    p_draft_id: input.draftId,
    p_item_id: input.itemId,
    p_product_id: input.productId,
  });

  if (error) {
    throw new Error("Failed to save product mapping: " + error.message);
  }

  return stockResultSchema.parse(data);
}

export async function listCompanySuggestions(
  name: string,
  limit = 8,
): Promise<StockCompany[]> {
  const companies = await listStockCompanies();
  const target = tokenSet(name);

  return companies
    .map((company) => ({
      company,
      score: similarityScore(target, tokenSet(company.canonical_name)),
    }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.company.canonical_name.localeCompare(right.company.canonical_name),
    )
    .slice(0, Math.min(Math.max(limit, 1), 9))
    .map((entry) => entry.company);
}

export async function listProductSuggestions(input: {
  companyId: string;
  description: string;
  unit: string | null | undefined;
  limit?: number;
}): Promise<StockProduct[]> {
  const supabase = getSupabaseAdmin();
  const normalizedUnit = normalizeStockUnit(input.unit ?? "");
  let query = supabase
    .from("stock_products")
    .select("id, company_id, canonical_name, unit, hsn_sac")
    .eq("company_id", input.companyId)
    .eq("active", true);

  if (normalizedUnit) {
    query = query.eq("normalized_unit", normalizedUnit);
  }

  const { data, error } = await query.limit(50);
  if (error) {
    throw new Error("Failed to load product suggestions: " + error.message);
  }

  const products = z.array(productSchema).parse(data ?? []);
  const target = tokenSet(input.description);

  return products
    .map((product) => ({
      product,
      score: similarityScore(target, tokenSet(product.canonical_name)),
    }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.product.canonical_name.localeCompare(right.product.canonical_name),
    )
    .slice(0, Math.min(Math.max(input.limit ?? 8, 1), 9))
    .map((entry) => entry.product);
}

function normalizeIdentifier(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function numericTokens(value: Set<string>): string[] {
  return [...value]
    .filter((token) => /^\d+(?:\.\d+)?$/.test(token))
    .sort();
}

function equalStringArrays(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function tokenSet(value: string): Set<string> {
  return new Set(
    normalizeProductDescription(value)
      .split(" ")
      .filter(Boolean),
  );
}

function similarityScore(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;

  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection += 1;
  }

  const union = new Set([...left, ...right]).size;
  const jaccard = union === 0 ? 0 : intersection / union;

  const leftNumbers = [...left].filter((token) => /^\d+(?:\.\d+)?$/.test(token));
  const rightNumbers = [...right].filter((token) => /^\d+(?:\.\d+)?$/.test(token));
  const numbersMatch =
    leftNumbers.length > 0 &&
    leftNumbers.length === rightNumbers.length &&
    leftNumbers.every((token) => rightNumbers.includes(token));

  return jaccard + (numbersMatch ? 0.25 : 0);
}
