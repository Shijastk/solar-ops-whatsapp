import { randomUUID } from "node:crypto";
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
    "duplicate_document",
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
    "stock_in_applied",
    "stock_in_already_applied",
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
  current_quantity: z.coerce.number().optional(),
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

const openingProductCandidateSchema = z.object({
  product_id: z.string().uuid(),
  company_id: z.string().uuid(),
  canonical_name: z.string(),
  unit: z.string(),
  hsn_sac: z.string().nullable(),
  similarity_score: z.coerce.number(),
});

type OpeningProductCandidate = z.infer<typeof openingProductCandidateSchema>;

export type OpeningProductDuplicateDecision =
  | {
      status: "opening_exists" | "potential_product_duplicate";
      product_id: string;
      product_name: string;
    }
  | null;

const balanceSchema = z.object({
  product_id: z.string().uuid(),
  company_id: z.string().uuid(),
  company_name: z.string(),
  company_gstin: z.string().nullable(),
  product_name: z.string(),
  unit: z.string(),
  hsn_sac: z.string().nullable(),
  current_quantity: z.coerce.number(),
  balance_known: z.boolean(),
});

const stockMovementSchema = z.object({
  id: z.string().uuid(),
  product_id: z.string().uuid(),
  company_id: z.string().uuid(),
  company_name: z.string(),
  company_gstin: z.string().nullable(),
  product_name: z.string(),
  unit: z.string(),
  hsn_sac: z.string().nullable(),
  movement_type: z.enum([
    "opening",
    "stock_in",
    "manual_out",
    "dispatch_inferred",
    "stock_out",
    "correction",
    "reversal",
    "adjustment",
  ]),
  quantity_delta: z.coerce.number(),
  created_at: z.string(),
  draft_id: z.string().uuid().nullable(),
  document_number: z.string().nullable(),
  document_date: z.string().nullable(),
  balance_after: z.coerce.number().nullable(),
});

export type StockResult = z.infer<typeof stockResultSchema>;
export type StockCompany = z.infer<typeof companySchema>;
export type StockProduct = z.infer<typeof productSchema>;
export type StockBalance = z.infer<typeof balanceSchema>;
export type StockMovement = z.infer<typeof stockMovementSchema>;

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

const PRODUCT_IDENTITY_TOKEN_ALIASES: Record<string, string> = {
  batteries: "battery",
  cables: "cable",
  connectors: "connector",
  fittings: "fitting",
  inverters: "inverter",
  modules: "module",
  panels: "panel",
  pieces: "piece",
  sets: "set",
  wires: "wire",
};

export function normalizeProductIdentityName(value: string): string {
  return normalizeProductDescription(value)
    .split(" ")
    .filter(Boolean)
    .map((token) => PRODUCT_IDENTITY_TOKEN_ALIASES[token] ?? token)
    .sort()
    .join(" ");
}

const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;
const GSTIN_TOKEN_PATTERN =
  /[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]/g;

export function canonicalStockCompanyName(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\s+\d{2}-\d{2}\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

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

export function decideOpeningProductDuplicate(input: {
  productName: string;
  hsnSac?: string | null;
  allowSimilarProduct?: boolean;
  candidates: OpeningProductCandidate[];
}): OpeningProductDuplicateDecision {
  const targetIdentity = normalizeProductIdentityName(input.productName);
  const targetTokens = tokenSet(input.productName);
  const targetNumbers = numericTokens(targetTokens);

  const hardEquivalent = input.candidates.find((candidate) => {
    if (
      normalizeProductIdentityName(candidate.canonical_name) !== targetIdentity
    ) {
      return false;
    }

    if (
      input.hsnSac &&
      candidate.hsn_sac &&
      normalizeIdentifier(input.hsnSac) !== normalizeIdentifier(candidate.hsn_sac)
    ) {
      return false;
    }

    return true;
  });

  if (hardEquivalent) {
    return {
      status: "opening_exists",
      product_id: hardEquivalent.product_id,
      product_name: hardEquivalent.canonical_name,
    };
  }

  if (input.allowSimilarProduct) return null;

  const potential = input.candidates
    .map((candidate) => {
      const productTokens = tokenSet(candidate.canonical_name);
      const sameNumbers = equalStringArrays(
        targetNumbers,
        numericTokens(productTokens),
      );
      const sameHsn =
        Boolean(input.hsnSac) &&
        Boolean(candidate.hsn_sac) &&
        normalizeIdentifier(input.hsnSac ?? "") ===
          normalizeIdentifier(candidate.hsn_sac ?? "");

      return {
        candidate,
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
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.candidate.similarity_score - left.candidate.similarity_score,
    )[0];

  if (!potential) return null;

  return {
    status: "potential_product_duplicate",
    product_id: potential.candidate.product_id,
    product_name: potential.candidate.canonical_name,
  };
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

async function insertStockCompanyAlias(input: {
  companyId: string;
  aliasText: string;
  source: "canonical" | "operator" | "document";
}) {
  const normalized = normalizeStockName(input.aliasText);
  if (!normalized) return;

  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("stock_company_aliases").insert({
    company_id: input.companyId,
    alias_text: input.aliasText.trim(),
    normalized_alias: normalized,
    source: input.source,
  });

  if (error && error.code !== "23505") {
    throw new Error("Failed to save stock company alias: " + error.message);
  }
}

async function insertStockProductAlias(input: {
  companyId: string;
  productId: string;
  aliasText: string;
  unit: string;
  source: "canonical" | "operator" | "document";
}) {
  const normalizedAlias = normalizeProductDescription(input.aliasText);
  const normalizedUnit = normalizeStockUnit(input.unit);
  if (!normalizedAlias || !normalizedUnit) return;

  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("stock_product_aliases").insert({
    company_id: input.companyId,
    product_id: input.productId,
    alias_text: input.aliasText.trim(),
    normalized_alias: normalizedAlias,
    normalized_unit: normalizedUnit,
    source: input.source,
  });

  if (error && error.code !== "23505") {
    throw new Error("Failed to save stock product alias: " + error.message);
  }
}

export async function ensureStockCatalogForDraft(
  draftId: string,
): Promise<{ companyId: string; productIds: string[] }> {
  const supabase = getSupabaseAdmin();
  const { data: draft, error: draftError } = await supabase
    .from("document_drafts")
    .select(
      "id, parse_status, workflow_status, supplier_name, supplier_gstin, stock_company_id",
    )
    .eq("id", draftId)
    .maybeSingle();

  if (draftError) {
    throw new Error("Failed to load draft stock identity: " + draftError.message);
  }
  if (
    !draft ||
    draft.parse_status !== "approved" ||
    draft.workflow_status !== "recorded"
  ) {
    throw new Error("Draft is not ready for stock catalog provisioning");
  }

  const supplierName = draft.supplier_name?.trim() || "";
  const supplierGstin = draft.supplier_gstin
    ? normalizeStockGstin(draft.supplier_gstin)
    : null;
  let companyId = draft.stock_company_id as string | null;

  if (!companyId && supplierGstin) {
    const { data, error } = await supabase
      .from("stock_companies")
      .select("id")
      .eq("gstin", supplierGstin)
      .eq("active", true)
      .maybeSingle();
    if (error) {
      throw new Error("Failed to resolve stock company GSTIN: " + error.message);
    }
    companyId = data?.id ?? null;
  }

  const canonicalCompanyName = canonicalStockCompanyName(supplierName);
  const companyNormalized = normalizeStockName(canonicalCompanyName);

  if (!companyId && companyNormalized) {
    const { data, error } = await supabase
      .from("stock_companies")
      .select("id")
      .eq("normalized_name", companyNormalized)
      .eq("active", true)
      .maybeSingle();
    if (error) {
      throw new Error("Failed to resolve stock company name: " + error.message);
    }
    companyId = data?.id ?? null;
  }

  if (!companyId) {
    if (!canonicalCompanyName || !supplierGstin) {
      throw new Error("Verified bill is missing a safe company identity");
    }

    const { data, error } = await supabase
      .from("stock_companies")
      .insert({
        canonical_name: canonicalCompanyName,
        normalized_name: companyNormalized,
        gstin: supplierGstin,
      })
      .select("id")
      .single();

    if (error) {
      if (error.code !== "23505") {
        throw new Error("Failed to create stock company: " + error.message);
      }

      const { data: existing, error: existingError } = await supabase
        .from("stock_companies")
        .select("id")
        .eq("gstin", supplierGstin)
        .maybeSingle();
      if (existingError || !existing) {
        throw new Error(
          "Failed to reload stock company after duplicate creation",
        );
      }
      companyId = existing.id;
    } else {
      companyId = data.id;
    }

    if (!companyId) {
      throw new Error("Failed to resolve created stock company");
    }

    await insertStockCompanyAlias({
      companyId,
      aliasText: canonicalCompanyName,
      source: "canonical",
    });
  }

  if (!companyId) {
    throw new Error("Failed to resolve stock company");
  }

  if (supplierName && normalizeStockName(supplierName) !== companyNormalized) {
    await insertStockCompanyAlias({
      companyId,
      aliasText: supplierName,
      source: "document",
    });
  }

  await supabase
    .from("document_drafts")
    .update({ stock_company_id: companyId })
    .eq("id", draftId);

  const { data: itemData, error: itemError } = await supabase
    .from("document_items")
    .select("id, description, normalized_description, hsn_sac, quantity, unit")
    .eq("draft_id", draftId)
    .order("line_index", { ascending: true });

  if (itemError) {
    throw new Error("Failed to load draft stock items: " + itemError.message);
  }

  const productIds: string[] = [];

  for (const item of itemData ?? []) {
    if (
      !item.description ||
      !item.normalized_description ||
      !item.unit ||
      Number(item.quantity) <= 0
    ) {
      throw new Error("Verified bill contains an invalid stock item");
    }

    const itemUnit = item.unit;
    const itemDescription = item.description;
    const normalizedUnit = normalizeStockUnit(itemUnit);
    const { data: alias, error: aliasError } = await supabase
      .from("stock_product_aliases")
      .select("product_id")
      .eq("company_id", companyId)
      .eq("normalized_alias", item.normalized_description)
      .eq("normalized_unit", normalizedUnit)
      .maybeSingle();

    if (aliasError) {
      throw new Error("Failed to resolve stock product alias: " + aliasError.message);
    }

    let productId = alias?.product_id ?? null;

    if (!productId) {
      const { data: candidateData, error: candidateError } = await supabase.rpc(
        "search_opening_stock_product_candidates",
        {
          p_query: item.normalized_description,
          p_company_id: companyId,
          p_unit: normalizedUnit,
          p_limit: 12,
        },
      );

      if (candidateError) {
        throw new Error(
          "Failed to search stock product identity: " + candidateError.message,
        );
      }

      const candidates = z
        .array(openingProductCandidateSchema)
        .parse(candidateData ?? []);
      const hardEquivalent = decideOpeningProductDuplicate({
        productName: itemDescription,
        hsnSac: item.hsn_sac,
        allowSimilarProduct: true,
        candidates,
      });

      if (hardEquivalent?.status === "opening_exists") {
        productId = hardEquivalent.product_id;
      }
    }

    if (!productId) {
      const { data: created, error: createError } = await supabase
        .from("stock_products")
        .insert({
          company_id: companyId,
          canonical_name: itemDescription.trim(),
          normalized_name: item.normalized_description,
          unit: itemUnit.trim().toUpperCase(),
          normalized_unit: normalizedUnit,
          hsn_sac: item.hsn_sac,
        })
        .select("id")
        .single();

      if (createError) {
        if (createError.code !== "23505") {
          throw new Error("Failed to create stock product: " + createError.message);
        }

        const { data: existing, error: existingError } = await supabase
          .from("stock_products")
          .select("id")
          .eq("company_id", companyId)
          .eq("normalized_name", item.normalized_description)
          .eq("normalized_unit", normalizedUnit)
          .maybeSingle();

        if (existingError || !existing) {
          throw new Error(
            "Failed to reload stock product after duplicate creation",
          );
        }
        productId = existing.id;
      } else {
        productId = created.id;
      }

      if (!productId) {
        throw new Error("Failed to resolve created stock product");
      }

      await insertStockProductAlias({
        companyId,
        productId,
        aliasText: itemDescription,
        unit: itemUnit,
        source: "canonical",
      });
    } else {
      await insertStockProductAlias({
        companyId,
        productId,
        aliasText: itemDescription,
        unit: itemUnit,
        source: "document",
      });
    }

    if (!productId) {
      throw new Error("Failed to resolve stock product");
    }
    productIds.push(productId);
  }

  return { companyId, productIds };
}

export async function recordStockIn(input: {
  productId: string;
  quantity: number | string;
  actionKey: string;
}): Promise<StockResult> {
  const productId = z.string().uuid().parse(input.productId);
  const quantity = quantitySchema.parse(input.quantity);
  const actionKey = z.string().uuid().parse(input.actionKey);
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase.rpc("record_stock_in", {
    p_product_id: productId,
    p_quantity: quantity,
    p_idempotency_key: actionKey,
  });

  if (error) {
    throw new Error("Failed to record stock in: " + error.message);
  }

  return stockResultSchema.parse(data);
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
  actionKey?: string;
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

  if (resolvedCompanyId) {
    const { data: candidateData, error: candidateError } = await supabase.rpc(
      "search_opening_stock_product_candidates",
      {
        p_query: parsed.productNormalized,
        p_company_id: resolvedCompanyId,
        p_unit: parsed.unitNormalized,
        p_limit: 12,
      },
    );

    if (candidateError) {
      throw new Error(
        "Failed to validate opening stock product identity: " +
          candidateError.message,
      );
    }

    const candidates = z
      .array(openingProductCandidateSchema)
      .parse(candidateData ?? []);
    const duplicateDecision = decideOpeningProductDuplicate({
      productName: parsed.productName,
      hsnSac: parsed.hsnSac,
      allowSimilarProduct: parsed.allowSimilarProduct,
      candidates,
    });

    if (duplicateDecision?.status === "opening_exists") {
      const adjusted = await adjustStockBalance({
        productId: duplicateDecision.product_id,
        targetQuantity: parsed.quantity,
        actionKey: input.actionKey ?? randomUUID(),
      });

      if (adjusted.status === "not_ready" || adjusted.status === "inconsistent") {
        return stockResultSchema.parse({
          status: adjusted.status,
          product_id: duplicateDecision.product_id,
          product_name: duplicateDecision.product_name,
        });
      }

      return stockResultSchema.parse({
        status:
          adjusted.status === "no_change" || adjusted.status === "already_adjusted"
            ? "opening_exists"
            : "opening_created",
        product_id: duplicateDecision.product_id,
        product_name: duplicateDecision.product_name,
        current_quantity: parsed.quantity,
      });
    }

    if (duplicateDecision) {
      return stockResultSchema.parse({
        status: duplicateDecision.status,
        company_id: resolvedCompanyId,
        product_id: duplicateDecision.product_id,
        product_name: duplicateDecision.product_name,
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
      "product_id, company_id, company_name, company_gstin, product_name, unit, hsn_sac, current_quantity, balance_known",
    )
    .order("company_name", { ascending: true })
    .order("product_name", { ascending: true });

  if (error) {
    throw new Error("Failed to load stock balances: " + error.message);
  }

  return z.array(balanceSchema).parse(data ?? []);
}

export async function listStockHistory(limit = 60): Promise<StockMovement[]> {
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 200);
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("stock_history")
    .select(
      "id, product_id, company_id, company_name, company_gstin, product_name, unit, hsn_sac, movement_type, quantity_delta, created_at, draft_id, document_number, document_date, balance_after",
    )
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(safeLimit);

  if (error) {
    throw new Error("Failed to load stock history: " + error.message);
  }

  return z.array(stockMovementSchema).parse(data ?? []);
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

