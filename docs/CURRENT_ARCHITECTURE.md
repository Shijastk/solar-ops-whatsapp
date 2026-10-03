# Current Architecture

This document describes the repository and deployed prototype as verified on 2026-09-21.

## Runtime

The application is a Next.js App Router project using TypeScript.

The webhook explicitly uses the Node.js runtime because the implementation uses Node cryptography and Buffer-based media handling.

## Deployment status

Verified Vercel project:

`solar-ops-whatsapp`

Framework:

`Next.js`

Stable production alias:

`https://solar-ops-whatsapp.vercel.app`

Verified state:

- production deployment: `READY`
- `/api/health`: HTTP 200
- `configured: true`
- Meta custom webhook verification succeeds
- Meta dashboard sample text reaches `POST /api/whatsapp`
- the sample text is persisted into `public.whatsapp_messages`

This proves the deployed text-ingestion database path for Meta's dashboard sample.

The credentialed provider harness also passed on 2026-09-21 and verified the synthetic media path end to end: Meta media upload/retrieval/download -> signed document webhook -> deployed Vercel endpoint -> private Supabase Storage -> database Storage path -> byte-integrity check -> cleanup.

Real inbound WhatsApp delivery from Meta to the custom callback is now verified.

On 2026-09-21:

- a real inbound text reached `POST /api/whatsapp` and logged `storedCount: 1`
- a real inbound PDF/document reached `POST /api/whatsapp` and logged `messageTypes: ['document']`, `storedCount: 1`, and `ignoredCount: 0`

Because `lib/ingest.ts` returns `stored` for media only after Meta media download, private Supabase Storage upload, and database finalization all succeed, the real PDF event verifies the complete Milestone 1 media path.

Milestone 1 is accepted.

## Current modules

### `app/api/whatsapp/route.ts`

Responsibilities:

- Meta GET verification
- reads raw POST body
- verifies `x-hub-signature-256`
- parses JSON only after signature validation
- normalizes WhatsApp messages
- hands individual messages to ingestion

### `lib/signature.ts`

Responsibilities:

- HMAC-SHA256 verification for Meta webhook POST requests
- timing-safe comparison

### `lib/whatsapp.ts`

Responsibilities:

- runtime webhook shape validation with Zod
- extract/normalize inbound message records
- map text and supported media metadata into an internal type

### `lib/meta.ts`

Responsibilities:

- fetch media metadata from Meta Graph API
- download media bytes using the access token
- enforce configured maximum media size

### `lib/ingest.ts`

Responsibilities:

- enforce optional sender allowlist
- enforce optional destination Phone Number ID check
- upsert message metadata into Supabase
- download supported media
- upload media to private Supabase Storage
- update processing state

### `lib/supabase-admin.ts`

Responsibilities:

- construct the server-only Supabase client

### `lib/env.ts`

Responsibilities:

- runtime validation of server environment configuration
- convert allowed sender string into a Set
- expose non-secret health configuration status

### `app/api/health/route.ts`

Responsibilities:

- report whether required environment variables are configured
- never return actual secret values

### `app/privacy/page.tsx`

Responsibilities:

- provide the public Solar Ops privacy policy required for Meta app publishing
- explain the inbound WhatsApp data flow and current receive-only scope
- disclose Meta, Vercel, and Supabase as service providers
- describe retention, security, sharing, and data-request handling without exposing secrets

### `scripts/integration/helpers.mjs`

Responsibilities:

- build synthetic text/document webhook fixtures
- generate a tiny synthetic PDF
- sign webhook bodies for controlled integration requests
- hash fixture bytes
- redact sensitive values from reports
- extract only safe Meta Graph error type/code/subcode/message diagnostics
- render the Markdown integration report

### `scripts/integration/run-whatsapp-e2e.mjs`

Responsibilities:

- verify deployed health and security-filter presence
- verify invalid-signature rejection
- verify sender allowlist and destination Phone Number ID enforcement
- verify text persistence and idempotency
- upload/retrieve/download a synthetic PDF through Meta Cloud API
- submit a signed synthetic document event to the deployed webhook
- verify Supabase row, private bucket, Storage path, and file-byte hash
- clean up synthetic database, Storage, and Meta media fixtures
- write redacted JSON and Markdown reports

### `.github/workflows/integration.yml`

Responsibilities:

- expose the credentialed suite only through manual `workflow_dispatch`
- inject provider credentials through GitHub Actions secrets
- force fixture cleanup
- upload the redacted integration report as a workflow artifact

## Data model

Current SQL source:

`supabase/schema.sql`

Primary table:

`public.whatsapp_messages`

Important properties:

- `whatsapp_message_id` is unique
- RLS is enabled
- no anon/authenticated policies are created
- server-side key is expected for webhook writes
- status values currently allowed:
  - `received`
  - `stored`
  - `failed`
  - `ignored`

## Storage

Expected bucket:

`whatsapp-media`

The bucket was created as private by the user during live setup.

The credentialed synthetic-media harness has verified upload/download through the private bucket, including SHA-256 byte-integrity checks and cleanup. A real Meta-delivered inbound PDF has also been verified through the deployed webhook.

Current path strategy is approximately:

`<sender>/<year>/<month>/<hashed-message-id>/<filename>`

## Environment variables currently referenced by source

- `WHATSAPP_VERIFY_TOKEN`
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `META_APP_SECRET`
- `META_GRAPH_API_VERSION`
- `ALLOWED_WHATSAPP_SENDERS`
- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- `SUPABASE_STORAGE_BUCKET`
- `MAX_MEDIA_BYTES`

Do not rename these without updating source, `.env.example`, README, and documentation together.

## Important boundary

Current source implements deterministic PDF document parsing, manual operator replies, Opening Stock, outgoing Stock OUT, and audited stock adjustments, but still has no:

- OCR pipeline for scanned/image-only PDFs
- automatic Stock IN / receiving-document model
- driver model
- porter model
- customer dashboard
- general-purpose automatic WhatsApp reply path outside the approved document workflow
- template-message path outside the customer-service window
- production-grade multi-user authentication

Do not describe those missing capabilities as existing features.


## Temporary media retention

Milestone 2A adds a low-cost raw-media lifecycle.

### `scripts/maintenance/media-retention.mjs`

Responsibilities:

- validate Supabase maintenance configuration
- calculate the retention cutoff
- query only successfully stored media with a non-null Storage path
- delete eligible private Storage objects
- clear `storage_path` only after successful object deletion
- leave failed items retryable
- emit count-only reports with no customer identifiers or file paths

Defaults:

- retention target: 24 hours
- maximum rows per run: 500
- Storage bucket: `whatsapp-media`

### `.github/workflows/media-retention.yml`

Responsibilities:

- run the cleanup once per day
- reuse the protected `integration` environment Supabase secrets
- allow explicit manual runs
- prevent overlapping cleanup runs
- upload a non-sensitive retention report artifact

The workflow is scheduled for 21:00 UTC daily. GitHub scheduling may be delayed, so the 24-hour value is a cutoff target rather than a guaranteed exact deletion time.

The retention workflow itself does not require changing the existing `whatsapp_messages` row shape. After successful deletion, the message row remains and only `storage_path` is cleared. Separate additive tables now hold structured document drafts/items and outbound-message state.


## Internal operations dashboard

A mobile-first internal verification UI is implemented at:

`/ops`

### Authentication

`lib/ops-auth.ts` provides:

- timing-safe access-key comparison
- optional dedicated `OPS_ACCESS_KEY`
- temporary fallback to `WHATSAPP_VERIFY_TOKEN` when no dedicated dashboard key is configured
- HMAC-signed, expiring session cookies using the existing server-side Meta app secret
- HttpOnly + SameSite=Strict cookie settings
- same-origin validation for state-changing POST requests

No Supabase secret or Meta access token is sent to the browser.

### Data access

`lib/ops-data.ts` performs server-only reads through the existing Supabase admin client and validates returned row shapes with Zod.

The dashboard renders a WhatsApp-Web-like two-pane conversation surface with masked sender references, inbound/outbound state, structured document review controls, and private file actions. The page itself is viewport-locked; the sidebar and chat timeline scroll independently.

### File preview

`GET /api/ops/media/[id]`:

- requires a valid operations session
- validates the message id
- resolves the current private Storage path
- creates a 5-minute Supabase signed URL server-side
- redirects the authenticated browser to that temporary URL

The bucket remains private.

### Manual deletion

`POST /api/ops/media/[id]/delete`:

- requires a valid operations session
- requires same-origin POST
- allows deletion only for successfully stored media
- removes the Storage object first
- clears `storage_path` only after Storage deletion succeeds
- preserves the WhatsApp message row and metadata

This web dashboard is internal only. It is not a customer portal.

Repository CI success does not by itself prove a source change is live. Production behavior is considered deployed only after the stable Vercel alias points at the expected main commit and the relevant route is verified.


## Structured document parsing

`lib/pdf-extract.ts` uses `unpdf` to extract positioned PDF text and reconstruct text lines without binding parsing to exact page coordinates. Untrusted PDF work is bounded by page count, extracted-text length, image allocation, and a timeout.

`lib/document-parser.ts` applies deterministic labels/anchors. Missing values remain null. Documents without a usable text layer become `needs_ocr`.

`lib/document-processing.ts` stores bounded extracted text plus structured data in `document_drafts` and `document_items`. Approved drafts are not silently overwritten.

New PDFs are parsed after successful private Storage persistence. Parser failure does not turn a successfully stored WhatsApp document into an ingestion failure.

No stock table is changed by parsing or approval.

## Manual WhatsApp replies

`lib/meta-messages.ts` sends operator-authored text replies through Meta's phone-number `/messages` endpoint and includes the stored inbound WhatsApp message ID as reply context.

`lib/replies.ts` derives recipients server-side, enforces the latest-inbound 24-hour service window, uses request IDs for send idempotency, persists outbound state, and applies timestamped Meta status webhooks.

Outbound state is stored in `whatsapp_outbound_messages`.

Meta non-2xx send responses are reduced to bounded, redacted HTTP/code/type/message diagnostics before they are persisted. Duplicate requests preserve their existing queued/failed/sent state instead of being blindly reported as sent.

The main webhook processes both inbound messages and outbound message-status notifications.

## WhatsApp-style operations UI

The protected `/ops` surface groups messages by hashed conversation keys and renders inbound/outbound bubbles. Document messages can expose structured fields/items plus parse, approve, private-view, and delete actions. The composer is enabled only while the 24-hour service window is open.

`app/ops/ops-live-client.tsx` supplies the client-only interaction layer:

- a short automatic refresh interval while the tab is visible
- refresh on browser focus/visibility return
- initial/latest-message scroll-to-bottom behavior
- preservation of history-reading position when the operator scrolls upward
- guarded reply submission so rapid clicks do not submit the same form repeatedly
- Enter-to-send and Shift+Enter newline behavior

This is deliberately a low-cost authenticated polling approach, not a claim of true provider-push realtime. Server-only Supabase credentials remain off the client.

Full phone numbers are not placed in dashboard URLs.

## Verified document automation

Milestone 2D adds an optional, server-only document verification and correction workflow.

### Configuration

`lib/env.ts` exposes:

- `DOCUMENT_AUTOMATION_ENABLED` (default `false`)
- `GROQ_API_KEY` (server-only)
- `GROQ_MODEL` (default `openai/gpt-oss-20b`)
- `GROQ_TIMEOUT_MS` (default 7000 ms)

Core WhatsApp ingestion remains independently healthy when this optional feature is disabled.

### Independent verification

`lib/document-verifier.ts` sends at most 24,000 extracted-text characters to Groq. It requests strict JSON Schema output and independently extracts the same persisted structured fields/items as the deterministic parser.

The verifier compares all persisted fields and every item description/HSN/quantity/unit/rate/amount. It also checks line arithmetic and, when available, the sum of line amounts against taxable amount. Any difference returns a mismatch list; it never merges competing values.

Schema compliance from Groq is treated only as transport/shape correctness, not proof of semantic correctness.

### Document workflow

`lib/document-automation.ts` manages workflow states `pending`, `recorded`, `review_required`, and `cancelled`.

Verification state is separate: `not_run`, `verified`, `needs_review`, `failed`, and `manual_override`.

A verified document can automatically send a concise WhatsApp summary with Edit/Delete buttons. The summary reports whether stock was applied, remains pending/blocked, or was reversed.

### Interactive WhatsApp flow

`lib/meta-messages.ts` supports text, reply-button, and list interactive messages through the existing Meta `/messages` endpoint.

`lib/whatsapp.ts` normalizes inbound `interactive.button_reply` and `interactive.list_reply` events.

The interaction ID is only a lookup hint. `lib/document-automation.ts` verifies the document belongs to the same stored sender before acting.

Edit uses a short-lived server-side `document_edit_sessions` row. After a field is chosen, the operator types only the corrected value. Valid corrections are stored as `manual_override` and written to `document_actions` with previous/new values.

Delete uses a second confirmation step and marks the document `cancelled`; structured data and audit history remain.

### Database additions

`document_drafts` adds verification/workflow/summary state.

`whatsapp_outbound_messages.message_kind` distinguishes text and interactive sends.

`document_actions` is an RLS-protected audit table.

`document_edit_sessions` stores one short-lived pending correction target per sender and is RLS-protected.

No anon/authenticated policies are created for these internal tables. Server-side service-role access is explicitly granted for new tables.

### Ingestion isolation

`lib/ingest.ts` runs document automation only after successful PDF storage and parsing. Automation/provider errors are caught separately, so a Groq or outbound failure does not convert already-stored inbound media into an ingestion failure.

After document verification/recording, the separate stock workflow may apply outgoing Stock OUT only when all Milestone 2E inventory checks pass. Document verification itself is not sufficient authority to mutate stock.


## Opening stock and inventory ledger

The approved outgoing-stock architecture adds a server-only inventory layer.

### Stock master

`stock_companies` stores canonical company identities and requires a non-null GSTIN. GSTIN is the mandatory strong identity for Opening Stock companies; company names/aliases remain secondary matching aids.

`stock_company_aliases` stores operator-approved supplier-name variants.

`stock_products` stores canonical products scoped to a company with canonical unit and optional HSN/SAC.

`stock_product_aliases` stores operator-approved bill-description variants scoped by company and unit.

Similarity scoring in application code is used only to rank WhatsApp suggestions. It is never an automatic identity decision.

### Ledger

`stock_ledger` is append-only for normal operations. Current quantity is derived through the `stock_balances` security-invoker view.

Current movement types in this milestone:

- `opening`
- `stock_out`
- `correction`
- `reversal`
- `adjustment`

The system does not yet create automatic Stock IN movements.

### Atomic database operations

Postgres RPC functions own stock-critical mutations so validation, balance checking, locking, and ledger writes happen in one database transaction.

The main operations are:

- create one-time Opening Stock
- set an existing product's current physical quantity through an immutable adjustment delta
- apply full-bill Stock OUT
- map a company alias
- map a product alias
- apply a document quantity correction
- reverse a bill's net deduction

Stock OUT locks all matched product rows in deterministic order before checking balances. A bill is rejected before inserts if any line fails.

### Document stock state

`document_drafts` carries a separate `stock_status` so document verification and inventory application are not conflated.

Possible operational states include:

- `not_ready`
- `pending`
- `applied`
- `needs_product_match`
- `company_unmapped`
- `insufficient_stock`
- `invalid_item`
- `inconsistent`
- `reversed`

### WhatsApp-first resolution

`lib/stock-workflow.ts` converts blocked stock states into WhatsApp interactions.

Unknown company/product spelling is resolved through interactive lists. The selected mapping is checked against the original WhatsApp sender, then saved as an alias and the entire bill is retried.

Insufficient stock produces a WhatsApp warning with required/available quantities and performs no partial deduction.

### Stock UI

`/ops/stock` is a protected internal stock-management page for one-time Opening Stock setup, current derived balances, and audited quantity adjustments.

Its visual layer is mobile-first and scoped independently from the WhatsApp chat UI. `.stockShell` defines light-theme design tokens for background/surfaces, text hierarchy, borders, accent/focus states, spacing, and radii. No third-party UI/design library is required.

On mobile, Current stock is the primary persistent surface. The longer new-product form is removed from the normal document flow and launched from a floating **Add stock** button as a bottom sheet. The same form remains inline on wider screens.

The mobile sheet uses the existing Opening Stock submit path and adds only presentation/accessibility behavior: backdrop and explicit close controls, Escape handling, temporary body-scroll lock, focus transfer/return, safe-area spacing, and a sticky Save action. Inventory uses responsive rows rather than a table that needs horizontal scrolling.

The page is implemented as a Next.js App Router hybrid: server components load protected stock data and a client `StockManager` performs add/adjust mutations through authenticated fetch requests. Successful mutations call `router.refresh()` to obtain fresh server-rendered data without a normal browser document reload.

The application as a whole is therefore not a pure client SPA. It is a hybrid server/client App Router application; the high-frequency stock and chat interactions are SPA-like while sensitive data access remains server-side.

`POST /api/ops/stock/opening` supports the client JSON flow and retains redirect compatibility.

`POST /api/ops/stock/adjust` sets a target current physical quantity by calling the atomic `adjust_stock_balance` RPC. The RPC locks the product, derives the current ledger total, and appends only the delta as an `adjustment` movement.

### Edit/Delete behavior

Quantity corrections after applied Stock OUT call an atomic correction RPC instead of rewriting ledger history.

Delete/cancellation calls the reversal RPC first. Workflow cancellation occurs only after a safe reversal or when no Stock OUT had been applied.


## Native mobile API

The backend now exposes a versioned native surface under `/api/mobile/v1`.

Available endpoints:

- `POST /session` - access-key exchange for an expiring signed Bearer session
- `GET /bootstrap` - real dashboard, PDF bills/drafts/items, document-derived dispatch fields, stock companies/balances and health state
- `POST /stock/opening` - existing Opening Stock validation/ledger path
- `POST /stock/adjust` - existing audited physical adjustment path
- `POST /messages/:id/parse`
- `POST /messages/:id/approve`
- `GET /messages/:id/media` - 5-minute signed PDF URL

Bearer authorization is validated server-side with the signed ops-session verifier. The mobile client never receives Supabase or Meta credentials.

There is still no standalone driver-assignment/delivery table. “Dispatch” data currently means parsed bill fields such as vehicle number, destination, consignee, workflow status and stock status.

## Fast WhatsApp operational query path

lib/whatsapp-queries.ts adds a bounded read-only path for routine operator questions that can be answered from already-persisted data.

The first deterministic intents are:

- today's received PDF-bill count
- pending/review-required bill count
- latest bill summary
- current stock for an exact canonical product name or operator-approved alias

The query path does not call Groq and does not re-open or re-parse a PDF. It reads only the rows required for the selected intent. Stock results come from stock_balances, which remains derived from the immutable ledger rather than a separate mutable cache.

lib/document-automation.ts runs this query handler only after stock/document interactive actions and any active text-correction session. This ordering prevents a correction such as a quantity-only reply from being reinterpreted as an operational question.

Unknown product spelling is not fuzzy-selected for a stock answer. The current fast path fails closed instead of returning a potentially incorrect balance. A later AI language/intent layer may be added only around targeted retrieval; it must not replace database facts or receive raw PDFs.

The outbound response reuses lib/replies.ts, including the active customer-service-window check and deterministic request-id idempotency.

### Bounded AI intent fallback

When the deterministic fast-query parser does not recognize a text question, lib/whatsapp-query-intent.ts can perform a second-stage Groq classification only if the message contains a Solar Ops domain hint.

The classifier is deliberately context-light:

- current user message only
- NFKC-normalized and capped at 500 characters
- no raw PDF
- no extracted bill body
- no database rows or ledger
- no previous chat history
- strict JSON Schema output
- maximum 120 completion tokens
- low reasoning effort

Supported classifier outputs map only to the existing targeted reads for today's bill count, pending bill count, latest bill, or exact stock balance. Unsupported meaning is ignored rather than guessed.

The query answer itself is still built from Postgres. Groq does not return the stock quantity, bill count, document total, or any other source-of-truth fact.

### Indexed fuzzy stock lookup

Read-only WhatsApp stock questions now keep exact canonical/alias lookup as the fastest path. On an exact miss, the backend calls the service-role-only search_stock_product_candidates RPC.

The RPC uses pg_trgm GiST indexes to retrieve only a bounded nearest-candidate set from canonical product names and approved aliases. Application code then rejects weak candidates and rejects candidates whose numeric/model tokens conflict with numbers explicitly present in the operator's query.

Fuzzy lookup never writes an alias and never participates in Stock OUT identity resolution. If more than one plausible stock entry remains, each is returned separately instead of being silently merged or selected.

### Fast-query reply latency

Direct operational query replies reuse the signed inbound message timestamp for the WhatsApp 24-hour service-window check instead of performing a second latest-message lookup. Reply idempotency lookup and reply-target lookup run in parallel. Other/manual reply paths keep the existing latest-inbound service-window check.

Fast-query logs record lookup, outbound-send, and total durations separately so future optimization is based on measured latency rather than guesswork.

### Deterministic opening-stock product identity

Before a new opening-stock product can be created, the backend performs a bounded service-role-only candidate lookup scoped to the resolved company and normalized unit.

The application then applies deterministic identity normalization. It normalizes casing/punctuation, ignores token order, and canonicalizes a conservative list of common singular/plural inventory nouns (for example `panel/panels`). Model numbers remain part of the identity.

A hard-equivalent existing product returns `opening_exists` even if a client sends `allowSimilarProduct=true`. Soft typo similarity still returns `potential_product_duplicate` unless an operator explicitly confirms that the product is genuinely different.

No AI model participates in opening-stock product identity.

### Ledger-first outgoing flow

After a document is approved and recorded, the stock workflow provisions a canonical company from the verified supplier GSTIN/name when needed, provisions or resolves products using deterministic product identity, stores bill wording as a document alias, then writes one idempotent `stock_out` movement per document item.

The stock-out RPC no longer rejects an outgoing movement because current quantity is insufficient. The `stock_balances` view remains a sum of immutable movements, so a balance can be negative until Stock IN/opening data is supplied.

The `stock_history` view joins ledger movements to company/product/document identity and calculates a per-product running balance. The mobile bootstrap exposes only the newest bounded history rows.

### Document verification fast path

After local PDF parsing, the backend first checks stock-critical identity fields and arithmetic locally. If that deterministic gate passes, the document is recorded with `verification_provider=local` and no Groq request is made.

If the local gate fails, the existing strict Groq extraction/comparison remains the fallback. WhatsApp response bodies are still deterministic templates selected by workflow status; the model does not author the user-facing reply.

### WhatsApp query routing

Inbound text follows a latency-first hierarchy:

1. deterministic trip/menu commands;
2. deterministic bill/trip/stock/date-range queries;
3. at most one bounded AI intent classification for operational wording not caught locally;
4. a bounded conversational AI fallback for non-operational text;
5. a fixed local fallback if the provider is unavailable.

Exact operational values always come from PostgreSQL. The AI classifier returns only intent/entity/period metadata.

### Trip closing concurrency

When done/ശരി/complete is received, the trip stops accepting new bills and moves directly to driver selection. Reserved PDFs continue processing. Selecting a driver never depends on the parser finishing. When all reserved documents have reached parsed/failed status, the backend derives destination/vehicle information and finalizes the trip automatically.

Trip destination is chosen across all processed trip bills: the most frequent destination wins; ties preserve the first-uploaded bill. If no destination text exists, the same majority/first rule is applied to PIN codes and the PIN lookup is used as a fallback location source.




## 2026-10-03 mobile simplification and duplicate repair

The mobile client uses three primary sections: Trips, Stock and History. Company switching filters each section by canonical company ID or exact GSTIN; it is an operations view switch within the shared operator account. Drivers and WhatsApp conversations live in a small menu. Direct PDF upload (maximum 4 MiB), grouping uploaded or existing bills into trips, driver creation/assignment, stock counting, bill review, quantity/vehicle/number correction and cancellation remain available. Older bills are searchable and retrievable on demand rather than included in every launch.

`/api/mobile/v1/home` is the compact launch API; the existing bootstrap API remains compatible with older clients and loads WhatsApp history only when requested. New write APIs require the same signed bearer authentication. Bill corrections/cancellation and their audit entries commit in one Postgres transaction. Trip attachment and closing serialize on the same trip row; closing requires a driver, parsed approved stock-posted bills and consistent vehicle identity. Ready means ready to dispatch, not delivered.

Mobile setup issues a 90-day signed session, stored with the compact cache in encrypted device storage. Cached data renders before network refresh and displays its sync timestamp. Offline data is never treated as confirmation of a server write. A 401 clears token and cache. Device authentication is optional (off by default), using fingerprint or the existing OS PIN/pattern; server authentication is retained. Shared HMAC sessions have no per-device revocation; secret rotation invalidates them.

Exact repeated PDF text reuses the existing approved active business draft while retaining the new inbound message. Different PDFs for the same normalized GSTIN+bill number or e-way number are blocked by transaction-level identity locks before catalog creation, inferred receipts or stock-out. Historical unposted copies are classified as duplicates without deleting records or replaying real stock. Identity claims survive cancellation; reuploading a cancelled bill does not silently undo it. Invoice numbers reused across financial years require review; this release keeps the existing conservative GSTIN+number identity rule.

Company aliases now accept `document`, matching the verified ingestion code and product-alias constraint. Catalog failures persist a stock error. Duplicate replies are short Already uploaded notices. Raw-file cleanup runs hourly after the 24-hour threshold using the Storage API; message metadata, extracted text, structured items, trip links and the immutable ledger remain. GitHub schedule delays mean deletion is approximate.

Migration ordering note: earlier repository migrations have timestamps later than their observed application time. The repair file is ordered after them so a fresh replay cannot overwrite the restored guard. Production was applied through the Supabase migration connector.
