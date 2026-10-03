import {
  getOpsMessageById,
  listOpsDraftsForMessages,
  type OpsMessage,
} from "@/lib/ops-data";
import { resolveMobileCompany, serializeDraft } from "@/lib/mobile-api";
import { listStockCompanies } from "@/lib/stock";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
export async function getMobileBill(id: string) {
  const [message, companies, drafts] = await Promise.all([
    getOpsMessageById(id),
    listStockCompanies(),
    listOpsDraftsForMessages([id]),
  ]);
  if (!message) return null;
  const draft = drafts.get(id),
    company = resolveMobileCompany(draft, companies);
  return {
    id: message.id,
    fileName: message.original_filename ?? "Bill",
    mimeType: message.mime_type,
    storageAvailable: !!message.storage_path,
    receivedAt: message.received_at,
    processingStatus: message.processing_status,
    companyId: company?.id ?? null,
    companyName: company?.canonical_name ?? null,
    companyGstin: company?.gstin ?? null,
    draft: serializeDraft(draft),
  };
}
export async function searchMobileBills(
  query: string,
  companyId: string | null,
) {
  const companies = await listStockCompanies();
  const company = companyId ? companies.find((c) => c.id === companyId) : null;
  if (companyId && !company) throw new Error("Company unavailable");
  const safe = query
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N} -]/gu, "")
    .trim()
    .slice(0, 100);
  if (safe.length < 2) return [];
  let request = getSupabaseAdmin()
    .from("document_drafts")
    .select("message_id")
    .neq("stock_status", "duplicate_document")
    .or(
      `document_number.ilike.%${safe}%,vehicle_number.ilike.%${safe}%,consignee_name.ilike.%${safe}%`,
    );
  if (company)
    request = request.or(
      `stock_company_id.eq.${company.id},supplier_gstin.eq.${company.gstin}`,
    );
  const { data, error } = await request
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) throw new Error("Could not search bills");
  const ids = (data ?? []).map((row) => row.message_id);
  if (!ids.length) return [];
  const [{ data: messages, error: messageError }, drafts] = await Promise.all([
    getSupabaseAdmin()
      .from("whatsapp_messages")
      .select(
        "id,original_filename,mime_type,storage_path,received_at,processing_status",
      )
      .in("id", ids),
    listOpsDraftsForMessages(ids),
  ]);
  if (messageError) throw new Error("Could not load bills");
  const byId = new Map(
    (messages ?? []).map((m) => [
      m.id,
      m as Pick<
        OpsMessage,
        | "id"
        | "original_filename"
        | "mime_type"
        | "storage_path"
        | "received_at"
        | "processing_status"
      >,
    ]),
  );
  return ids
    .map((id) => {
      const m = byId.get(id),
        d = drafts.get(id);
      if (!m) return null;
      const c = resolveMobileCompany(d, companies);
      return {
        id: m.id,
        fileName: m.original_filename ?? "Bill",
        mimeType: m.mime_type,
        storageAvailable: !!m.storage_path,
        receivedAt: m.received_at,
        processingStatus: m.processing_status,
        companyId: c?.id ?? null,
        companyName: c?.canonical_name ?? null,
        companyGstin: c?.gstin ?? null,
        draft: serializeDraft(d),
      };
    })
    .filter(Boolean);
}
