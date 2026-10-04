import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  listStockCompanies,
  normalizeStockGstin,
  normalizeStockName,
  normalizeStockUnit,
  normalizeProductIdentityName,
} from "@/lib/stock";

export async function createMobileCompany(
  name: string,
  gstinInput: string,
  allowSimilar = false,
) {
  const gstin = normalizeStockGstin(gstinInput);
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(gstin))
    throw new Error("Enter a valid GSTIN");
  const normalized = normalizeStockName(name);
  if (!normalized) throw new Error("Enter a company name");
  const companies = await listStockCompanies();
  const byGstin = companies.find((c) => c.gstin === gstin);
  if (byGstin)
    return {
      id: byGstin.id,
      name: byGstin.canonical_name,
      gstin: byGstin.gstin,
    };
  if (
    companies.some((c) => normalizeStockName(c.canonical_name) === normalized)
  )
    throw new Error("This company name already has another GSTIN");
  const tokens = new Set(normalized.split(" "));
  const similar = companies.find((c) => {
    const other = new Set(normalizeStockName(c.canonical_name).split(" "));
    const shared = [...tokens].filter((t) => other.has(t)).length;
    return (2 * shared) / (tokens.size + other.size) >= 0.78;
  });
  if (similar && !allowSimilar)
    return {
      status: "potential_company_duplicate",
      name: similar.canonical_name,
    };
  const { data, error } = await getSupabaseAdmin()
    .from("stock_companies")
    .insert({ canonical_name: name.trim(), normalized_name: normalized, gstin })
    .select("id,canonical_name,gstin")
    .single();
  if (error)
    throw new Error(
      "Company could not be created. Check for an existing company.",
    );
  return { id: data.id, name: data.canonical_name, gstin: data.gstin };
}

export const manualItemSchema = z.object({
  productId: z.uuid().nullable().optional(),
  productName: z.string().trim().min(1).max(200),
  unit: z.string().trim().min(1).max(20),
  quantity: z
    .number()
    .positive()
    .max(1_000_000_000)
    .refine(
      (n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 0.0001,
      "Use at most three decimal places",
    ),
});
export async function resolveManualProducts(
  companyId: string,
  items: z.infer<typeof manualItemSchema>[],
) {
  const db = getSupabaseAdmin();
  const resolved = [];
  for (const item of items) {
    if (item.productId) {
      resolved.push({ productId: item.productId, quantity: item.quantity });
      continue;
    }
    const normalized = normalizeStockName(item.productName),
      unit = normalizeStockUnit(item.unit);
    if (!normalized || !unit) throw new Error("Check product name and unit");
    const { data: candidates, error: lookupError } = await db
      .from("stock_products")
      .select("id,canonical_name")
      .eq("company_id", companyId)
      .eq("normalized_unit", unit)
      .eq("active", true);
    if (lookupError) throw new Error("Could not check products");
    const identity = normalizeProductIdentityName(item.productName);
    const existing = (candidates ?? []).filter(
      (p) => normalizeProductIdentityName(p.canonical_name) === identity,
    );
    if (existing.length > 1)
      throw new Error("Choose the exact existing product");
    let productId = existing[0]?.id;
    if (!productId) {
      const { data, error } = await db
        .from("stock_products")
        .upsert(
          {
            company_id: companyId,
            canonical_name: item.productName,
            normalized_name: normalized,
            unit: item.unit,
            normalized_unit: unit,
          },
          {
            onConflict: "company_id,normalized_name,normalized_unit",
            ignoreDuplicates: true,
          },
        )
        .select("id")
        .maybeSingle();
      if (error) throw new Error("Could not add product");
      productId = data?.id;
      if (!productId) {
        const result = await db
          .from("stock_products")
          .select("id")
          .eq("company_id", companyId)
          .eq("normalized_name", normalized)
          .eq("normalized_unit", unit)
          .single();
        if (result.error) throw new Error("Could not load product");
        productId = result.data.id;
      }
    }
    resolved.push({ productId, quantity: item.quantity });
  }
  return resolved;
}
