import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

const AGENT_CONTEXT_TTL_MS = 10 * 60 * 1000;
const BUSINESS_SCOPE = "solar-ops";

const contextIntentSchema = z.enum([
  "driver_count",
  "driver_list",
  "stock_balance",
  "stock_inventory_summary",
  "today_bill_count",
  "pending_bill_count",
  "latest_bill",
  "today_trip_summary",
  "yesterday_trip_summary",
  "driver_trip_summary",
  "today_products_summary",
  "yesterday_products_summary",
  "latest_trip",
  "ops_period_summary",
]);

const dateScopeSchema = z.enum([
  "today",
  "yesterday",
  "this_week",
  "this_month",
  "this_year",
  "last_week",
  "last_month",
  "last_year",
]);

const persistedContextSchema = z.object({
  last_intent: contextIntentSchema,
  last_entity_ids: z.array(z.string().max(128)).max(20),
  last_entity_names: z.array(z.string().max(120)).max(20),
  last_date_scope: dateScopeSchema.nullable(),
  company_scope: z.string().max(120).nullable(),
  expires_at: z.string().datetime({ offset: true }),
});

const saveContextInputSchema = z.object({
  senderPhone: z.string().min(5).max(32),
  businessScope: z.string().min(1).max(64).default(BUSINESS_SCOPE),
  lastIntent: contextIntentSchema,
  entityIds: z.array(z.string().max(128)).max(20).default([]),
  entityNames: z.array(z.string().max(120)).max(20).default([]),
  dateScope: dateScopeSchema.nullable().default(null),
  companyScope: z.string().max(120).nullable().default(null),
});

export type AgentContextIntent = z.infer<typeof contextIntentSchema>;
export type AgentContextDateScope = z.infer<typeof dateScopeSchema>;
export type AgentContext = {
  lastIntent: AgentContextIntent;
  entityIds: string[];
  entityNames: string[];
  dateScope: AgentContextDateScope | null;
  companyScope: string | null;
  expiresAt: string;
};

export async function saveAgentContext(input: {
  senderPhone: string;
  businessScope?: string;
  lastIntent: AgentContextIntent;
  entityIds?: string[];
  entityNames?: string[];
  dateScope?: AgentContextDateScope | null;
  companyScope?: string | null;
}): Promise<void> {
  const parsed = saveContextInputSchema.parse(input);
  const now = new Date();
  const updatedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + AGENT_CONTEXT_TTL_MS).toISOString();

  const { error } = await getSupabaseAdmin()
    .from("ops_agent_conversation_context")
    .upsert(
      {
        sender_phone: parsed.senderPhone,
        business_scope: parsed.businessScope,
        last_intent: parsed.lastIntent,
        last_entity_ids: parsed.entityIds,
        last_entity_names: parsed.entityNames,
        last_date_scope: parsed.dateScope,
        company_scope: parsed.companyScope,
        updated_at: updatedAt,
        expires_at: expiresAt,
      },
      { onConflict: "sender_phone,business_scope" },
    );

  if (error) {
    throw new Error("Failed to save agent context: " + error.message);
  }
}

export async function loadAgentContext(
  senderPhone: string,
  businessScope = BUSINESS_SCOPE,
): Promise<AgentContext | null> {
  const now = new Date();
  const { data, error } = await getSupabaseAdmin()
    .from("ops_agent_conversation_context")
    .select(
      "last_intent, last_entity_ids, last_entity_names, last_date_scope, company_scope, expires_at",
    )
    .eq("sender_phone", senderPhone)
    .eq("business_scope", businessScope)
    .gt("expires_at", now.toISOString())
    .maybeSingle();

  if (error) {
    throw new Error("Failed to load agent context: " + error.message);
  }
  if (!data) return null;

  const parsed = persistedContextSchema.safeParse(data);
  if (!parsed.success) {
    console.warn("Ignoring malformed agent context row");
    return null;
  }

  const expiresAt = Date.parse(parsed.data.expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;

  return {
    lastIntent: parsed.data.last_intent,
    entityIds: parsed.data.last_entity_ids,
    entityNames: parsed.data.last_entity_names,
    dateScope: parsed.data.last_date_scope,
    companyScope: parsed.data.company_scope,
    expiresAt: parsed.data.expires_at,
  };
}
