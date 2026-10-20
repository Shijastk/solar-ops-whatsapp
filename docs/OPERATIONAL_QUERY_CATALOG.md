# Solar Ops Operational Query Catalogue

## Purpose

This is the canonical inventory of user-facing operational intents. The runtime registry is `lib/operational-query-catalog.ts`; its IDs are used to build the structured intent-classifier schema, so adding/removing a classifier intent cannot silently drift from the catalogue.

The resolver may interpret Malayalam, Manglish, English, punctuation, or common voice-transcription variants, but it must route the meaning to a registered intent. It must not generate SQL or invent business facts. Each registered read intent has a documented source and result contract; the server-side executor remains responsible for authorization, parameter validation, bounded queries, and rendering database-backed results.

## Request pipeline

1. **Normalize** Unicode and whitespace; preserve the original message for language-aware replies.
2. **Resolve intent** with deterministic rules first where safe, then the structured semantic classifier for unresolved messages.
3. **Extract entities** such as canonical driver, product phrase, vehicle, destination, and date/period.
4. **Validate** required entities and resolve names against authoritative records. Ambiguous or unknown entities must ask for clarification rather than widening the query.
5. **Execute** only an allow-listed server-side query/action. Never let model output supply SQL, table names, status predicates, or authorization decisions.
6. **Format** from returned data only. A query error is not a zero result; known zero and unknown quantity must remain distinct.
7. **Evaluate** intent accuracy, entity extraction, query parameters, response shape, safety, and end-to-end database behavior separately.

## Canonical intents currently in the classifier

| Intent ID | Meaning | Required entities | Source/semantics |
|---|---|---|---|
| `today_bill_count` | Bills received today | — | Bill/document received timestamps; no pricing in replies |
| `pending_bill_count` | Bills requiring review | — | Existing pending/review state |
| `latest_bill` | Most recently received bill | — | Bill/document ordering by received timestamp; restricted pricing omitted |
| `stock_balance` | Quantity for one product | Product | Authoritative stock-balance query; distinguish unknown from zero |
| `stock_inventory_summary` | List current stock | — | Bounded current inventory summary; preserve company scope and unknown quantities |
| `start_trip` | Start/create a trip | Workflow-specific | **Action, not a read query**; use the trip workflow's validations and confirmation rules |
| `today_trip_summary` | Today's finalized trips | — | Current implementation uses `delivery_trips.status = ready` and `finalized_at` |
| `yesterday_trip_summary` | Yesterday's finalized trips | — | Same status semantics, India-local day bounds |
| `driver_trip_summary` | Trips for one exact driver today/yesterday | Driver | Exact driver-directory match; India-local day bounds |
| `driver_trip_list` | Bounded all-time list of saved finalized trips for one exact driver | Driver | Exact driver-directory match; newest 50 rows maximum, with total count when available |
| `driver_count` | Active driver count | — | Active `ops_drivers` records |
| `today_products_summary` | Products on today's finalized trips | — | Linked trip documents/items; not a generic stock-out ledger |
| `yesterday_products_summary` | Products on yesterday's finalized trips | — | Linked trip documents/items; not a generic stock-out ledger |
| `latest_trip` | Most recent finalized trip | — | Stored trip record and finalized timestamp |
| `ops_period_summary` | Operational counts for supported period | Period | Existing operational summary RPC; this/last week, month, year |

`unsupported` is the classifier's safe no-route result, not a query executor.

## Deterministic execution variants

The fast executor also has runtime variants that are not separate LLM intent IDs:

- `trip_filter_summary`: trip list filtered by exact vehicle or destination, currently today/yesterday only.
- `stock_product_required`: clarification state used when a product-specific stock request has no product entity.
- `stock_balance`: receives a normalized product phrase from either deterministic parsing or the semantic classifier.

These are implementation details and should not be duplicated as classifier labels unless there is a distinct user-facing semantic need.

## Requested query families and current support boundary

| Query family | Current state | Notes |
|---|---|---|
| Driver + today/yesterday + trip count/details | Implemented | Exact driver match; unknown/partial names must not fall back to company-wide results |
| All-time list for a named driver | Implemented | Lists newest saved finalized trips, bounded to 50 rows and includes total count |
| Arbitrary date or explicit date range for a driver's trips | Not yet implemented | Requires typed start/end date extraction and explicit timezone/date validation |
| Total current stock | Implemented as inventory summary | Result is bounded; do not claim an unbounded complete catalogue if truncated |
| One product's current stock | Implemented | Product must be present and resolved against stock data |
| Today's/yesterday's trip summary | Implemented | Uses finalized/ready semantics, not all created trips |
| Arbitrary daily trip summary by a user-specified date | Not yet implemented | Add a canonical date parameter only after date-bounds tests |
| Products on completed trips today/yesterday | Implemented | Not interchangeable with stock ledger dispatch/stock-out movements |
| Dispatch count/details by driver/date | Not yet independently implemented | Do not infer dispatch from trip count |
| Bill counts, pending review, latest bill | Implemented | WhatsApp pricing restriction remains in force |
| Driver list | Separate existing driver-agent path | Do not conflate directory listing with the `driver_count` classifier intent |
| Mutating operations (trip creation, driver changes, stock changes) | Separate workflows | Never route a read question into a mutation; existing confirmation and idempotency boundaries apply |

The catalogue intentionally distinguishes **implemented** from **planned**. A phrase is not considered supported merely because the LLM can understand it; it is supported only when a validated executor and appropriate tests exist.

## Entity and date contracts

- Driver: resolve against the active `ops_drivers` directory. Never substring-match or silently select among duplicate/ambiguous names.
- Product: use existing stock-product resolution and canonical matching. Unknown stock quantity is not equivalent to numeric zero.
- Date: relative dates use `Asia/Kolkata`; explicit calendar-day bounds must be half-open `[start, end)`.
- Trip count: count unique trip records under an explicitly documented status/time predicate; never count joined bill rows.
- Dispatch: must use the authoritative dispatch/stock-out definition when added; do not use finalized trips as a proxy without business semantics being confirmed.
- Errors: database/provider errors must remain errors/fallbacks, never be formatted as zero.
- Pricing: operational WhatsApp replies must not include product pricing.

## Test and rollout gates

- Unit tests assert the catalogue, required entities, intent/schema alignment, and known boundaries.
- Parser tests cover Malayalam, Manglish, English, reordered driver/date phrases, generic trip questions, and generic question words that must not be treated as names.
- Live intent evaluation tests classifier accuracy and safety on synthetic inputs only.
- Database workflow tests validate query/migration semantics against isolated PostgreSQL fixtures.
- Production logs and real user examples are used for diagnosis, but production business records must not be modified for tests.
- Merge/deployment is a separate rollout decision; passing CI does not itself mean the changes are live.
