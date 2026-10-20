export const AI_OPERATIONAL_INTENT_IDS = [
  "today_bill_count",
  "pending_bill_count",
  "latest_bill",
  "stock_balance",
  "stock_inventory_summary",
  "company_directory",
  "start_trip",
  "today_trip_summary",
  "yesterday_trip_summary",
  "driver_trip_summary",
  "driver_trip_list",
  "trip_filter_summary",
  "driver_count",
  "today_products_summary",
  "yesterday_products_summary",
  "latest_trip",
  "ops_period_summary",
] as const;

export type AiOperationalIntentId = (typeof AI_OPERATIONAL_INTENT_IDS)[number];

export type OperationalQueryDefinition = {
  domain: "bills" | "stock" | "trips" | "drivers" | "operations";
  kind: "read" | "action";
  description: string;
  requiredEntities: readonly string[];
  optionalEntities: readonly string[];
  source: string;
  resultSemantics: string;
  status: "implemented" | "action-separate";
  examples: readonly string[];
};

/**
 * Canonical intent registry used by both the classifier schema and tests.
 * User wording belongs in examples/normalization, never in SQL generation.
 */
export const OPERATIONAL_QUERY_CATALOG = {
  today_bill_count: {
    domain: "bills",
    kind: "read",
    description: "Count PDF bills received today",
    requiredEntities: [],
    optionalEntities: ["date"],
    source: "bill/document records and their received timestamp",
    resultSemantics: "Count received bills for the India-local calendar day; do not expose pricing",
    status: "implemented",
    examples: ["How many bills came today?", "ഇന്ന് എത്ര ബിൽ വന്നു?"],
  },
  pending_bill_count: {
    domain: "bills",
    kind: "read",
    description: "Count bills that need review",
    requiredEntities: [],
    optionalEntities: ["status"],
    source: "bill/document review state",
    resultSemantics: "Count records in the application's pending/review state only",
    status: "implemented",
    examples: ["How many bills need checking?", "പരിശോധിക്കാനുള്ള ബില്ലുകൾ എത്ര?"],
  },
  latest_bill: {
    domain: "bills",
    kind: "read",
    description: "Summarize the most recently received bill",
    requiredEntities: [],
    optionalEntities: [],
    source: "bill/document records ordered by received timestamp",
    resultSemantics: "Return the latest bill metadata; never reveal restricted price details",
    status: "implemented",
    examples: ["Show the latest bill", "ലാസ്റ്റ് ബിൽ ഏതാണ്?"],
  },
  stock_balance: {
    domain: "stock",
    kind: "read",
    description: "Read current stock for one named product",
    requiredEntities: ["product"],
    optionalEntities: ["company", "warehouse"],
    source: "authoritative stock balance query/view",
    resultSemantics: "Return only a verified quantity; distinguish unknown from known zero and ask for a product if absent",
    status: "implemented",
    examples: ["How many 550W panels are left?", "ഈ inverter എത്ര എണ്ണം ബാക്കിയുണ്ട്?"],
  },
  stock_inventory_summary: {
    domain: "stock",
    kind: "read",
    description: "List current stock balances across the configured inventory scope, optionally restricted to a named company",
    requiredEntities: [],
    optionalEntities: ["company", "warehouse", "category"],
    source: "authoritative stock balance query/view",
    resultSemantics: "Bound result size; preserve company identity and unknown quantities; omit pricing",
    status: "implemented",
    examples: ["Show our stock list", "Stockil ethokke products undu?", "Savitr Solar-il ethokke products stock und?", "savitr solar stock ethra und?", "സ്റ്റോക്ക് ലിസ്റ്റ് കാണിക്കൂ"],
  },
  company_directory: {
    domain: "operations",
    kind: "read",
    description: "List active company directory names or check whether a named company is known; not for asking what products a company has in stock",
    requiredEntities: [],
    optionalEntities: ["company"],
    source: "active stock_companies directory",
    resultSemantics: "Use only for company-name directory questions. If the user asks for stock, products, items, or balance for a named company, use stock_inventory_summary with company_name instead.",
    status: "implemented",
    examples: ["Which companies are available now?", "Savtr Solar enna company ninakkariyamo?", "ഇപ്പോൾ ഏതൊക്കെ കമ്പനികൾ available ആണ്?"],
  },
  start_trip: {
    domain: "trips",
    kind: "action",
    description: "Explicitly request starting/creating a trip; never for trip status/history or future/scheduled questions",
    requiredEntities: [],
    optionalEntities: ["driver", "vehicle", "destination", "bill context"],
    source: "trip creation workflow; not the read-query executor",
    resultSemantics: "Never create a trip from a status/history question; require the existing workflow's required fields and confirmation rules",
    status: "action-separate",
    examples: ["Start a new trip", "പുതിയ ട്രിപ്പ് തുടങ്ങണം"],
  },
  today_trip_summary: {
    domain: "trips",
    kind: "read",
    description: "Summarize trips finalized today",
    requiredEntities: [],
    optionalEntities: ["status"],
    source: "delivery_trips finalized_at and status",
    resultSemantics: "Current implementation reports ready/finalized trips, not every trip record or dispatch; errors must not be rendered as zero",
    status: "implemented",
    examples: ["How many trips completed today?", "ഇന്ന് എത്ര ട്രിപ്പ് പൂർത്തിയായി?"],
  },
  yesterday_trip_summary: {
    domain: "trips",
    kind: "read",
    description: "Summarize trips finalized yesterday",
    requiredEntities: [],
    optionalEntities: ["status"],
    source: "delivery_trips finalized_at and status",
    resultSemantics: "Use Asia/Kolkata calendar-day bounds and the same explicit finalized/ready semantics as the today summary",
    status: "implemented",
    examples: ["How many trips completed yesterday?", "ഇന്നലെ എത്ര ട്രിപ്പ് പൂർത്തിയായി?"],
  },
  driver_trip_summary: {
    domain: "trips",
    kind: "read",
    description: "Summarize trips for one exact active driver",
    requiredEntities: ["driver"],
    optionalEntities: ["date"],
    source: "ops_drivers identity joined to delivery_trips",
    resultSemantics: "Resolve the exact driver record; current executor supports today/yesterday only; never degrade an unresolved driver to a company-wide count",
    status: "implemented",
    examples: ["Innale Majeed ethra trip poyi?", "How many trips did Rasheed do today?", "റഷീദ് ഇന്നലെ എത്ര ട്രിപ്പ് പോയി?"],
  },
  driver_trip_list: {
    domain: "trips",
    kind: "read",
    description: "List the most recent saved finalized trips for one exact driver across all dates",
    requiredEntities: ["driver"],
    optionalEntities: ["limit"],
    source: "ops_drivers identity joined to delivery_trips",
    resultSemantics: "Resolve the exact driver record; return newest finalized/ready trips across all dates with a bounded list; report total count separately when available; never include trips for another driver",
    status: "implemented",
    examples: ["Majeedinte aake trip list cheyyamo", "List all trips for Majeed", "മജീദിന്റെ എല്ലാ ട്രിപ്പുകളും കാണിക്കൂ"],
  },
  trip_filter_summary: {
    domain: "trips",
    kind: "read",
    description: "Filter finalized trips by a named vehicle registration or destination, optionally for today or yesterday",
    requiredEntities: ["filter_by", "filter_value"],
    optionalEntities: ["date"],
    source: "delivery_trips finalized records",
    resultSemantics: "Use an exact normalized vehicle or a safely matched destination; never infer a vehicle or destination; preserve date scope",
    status: "implemented",
    examples: ["Trips for KL 11 AB 1234 yesterday", "Kozhikode-lekku poya trips ethra?", "Show trips to Kannur today"],
  },
  driver_count: {
    domain: "drivers",
    kind: "read",
    description: "Count active drivers",
    requiredEntities: [],
    optionalEntities: ["active status"],
    source: "ops_drivers",
    resultSemantics: "Count active directory records only",
    status: "implemented",
    examples: ["How many active drivers?", "Active drivers count എത്ര?"],
  },
  today_products_summary: {
    domain: "trips",
    kind: "read",
    description: "Summarize products associated with trips finalized today",
    requiredEntities: [],
    optionalEntities: ["product"],
    source: "finalized delivery trips and linked trip documents/items",
    resultSemantics: "Reflect the current completed-trip scope; do not treat as a generic stock-out ledger report",
    status: "implemented",
    examples: ["Which products went out today?", "Innu poya products ethokke?"],
  },
  yesterday_products_summary: {
    domain: "trips",
    kind: "read",
    description: "Summarize products associated with trips finalized yesterday",
    requiredEntities: [],
    optionalEntities: ["product"],
    source: "finalized delivery trips and linked trip documents/items",
    resultSemantics: "Reflect the current completed-trip scope; do not treat as a generic stock-out ledger report",
    status: "implemented",
    examples: ["Which products went out yesterday?", "Innale poya products ethokke?"],
  },
  latest_trip: {
    domain: "trips",
    kind: "read",
    description: "Summarize the most recent finalized trip",
    requiredEntities: [],
    optionalEntities: [],
    source: "delivery_trips ordered by finalized timestamp",
    resultSemantics: "Return actual stored trip details only",
    status: "implemented",
    examples: ["Show latest trip details", "അവസാനത്തെ ട്രിപ്പിന്റെ വിവരങ്ങൾ"],
  },
  ops_period_summary: {
    domain: "operations",
    kind: "read",
    description: "Summarize operational counts over a supported named period",
    requiredEntities: ["period"],
    optionalEntities: [],
    source: "operational summary RPC",
    resultSemantics: "Supported periods are this/last week, month, and year; labels and bounds use Asia/Kolkata",
    status: "implemented",
    examples: ["Give this week's operations summary", "കഴിഞ്ഞ ആഴ്ചയുടെ summary"],
  },
} as const satisfies Record<AiOperationalIntentId, OperationalQueryDefinition>;

export function getOperationalQueryDefinition(
  intent: AiOperationalIntentId,
): OperationalQueryDefinition {
  return OPERATIONAL_QUERY_CATALOG[intent];
}


/** Compact catalogue-generated guidance shared with the semantic classifier. */
export const OPERATIONAL_QUERY_CATALOG_PROMPT = AI_OPERATIONAL_INTENT_IDS
  .map((intent) => {
    const definition = OPERATIONAL_QUERY_CATALOG[intent];
    return intent + " = " + definition.description + ". Examples: " + definition.examples.join(" / ");
  })
  .join("; ");
