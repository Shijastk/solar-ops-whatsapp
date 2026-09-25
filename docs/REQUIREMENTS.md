# Requirements

Status: Milestone 1 accepted on 2026-09-21

## Goal

Reliably receive inbound WhatsApp messages sent to the Solar Ops WhatsApp account and store their metadata and supported media without requiring a separate operator app.

## Functional requirements

### R1 - Webhook verification

The backend must expose a Meta-compatible webhook verification endpoint.

Current route:

`GET /api/whatsapp`

It must return the supplied Meta challenge only when the verify token matches the server configuration.

### R2 - Incoming webhook

The backend must accept:

`POST /api/whatsapp`

It must parse supported WhatsApp Business Account `messages` webhook events.

### R3 - Authenticity check

Incoming POST requests must be rejected when the Meta webhook signature is missing or invalid.

### R4 - Text messages

For supported inbound text messages, store at least:

- WhatsApp message ID
- sender phone
- sender name when supplied
- message type
- text body
- received timestamp
- destination phone number metadata when supplied

### R5 - Media messages

Initial supported media categories:

- document/PDF
- image
- audio/voice
- video
- sticker

For media, the system should:

1. retain message metadata
2. retrieve media from Meta using the server-side access token
3. upload the bytes to the configured private Supabase Storage bucket
4. store the resulting internal Storage path in the database

### R6 - No temporary URL dependency

Meta temporary attachment URLs must not be treated as permanent storage.

### R7 - Idempotency

The same WhatsApp message ID arriving multiple times must not create duplicate database rows.

### R8 - Private storage

Received business documents must be stored in a non-public Supabase bucket.

### R9 - Sender restriction

The prototype must support an optional allowlist of permitted inbound WhatsApp sender numbers.

### R10 - Processing state

A message must expose a clear state such as:

- received
- stored
- failed

Failure information should be persisted for debugging when possible.

### R11 - No outbound messaging

Milestone 1 must not automatically send WhatsApp replies.

### R12 - No OCR yet

Milestone 1 must not:

- run OCR
- infer company names
- extract invoice line items
- modify inventory

Those belong to a later explicitly approved milestone.

### R13 - Public privacy policy

The deployed application must expose a public privacy policy at:

`/privacy`

The policy must accurately describe the current inbound WhatsApp data flow, categories of data processed, purposes, service providers, storage/retention, security controls, sharing, and access/correction/deletion requests.

It must not publish credentials, customer documents, internal costs, or other operational secrets.

## Non-functional requirements

### N1 - Readability

Implementation must favor maintainable, explicit TypeScript over clever abstractions.

### N2 - Secret isolation

All provider credentials remain server-side environment variables.

### N3 - Minimal cost

The prototype should remain compatible with zero/low-cost free tiers during validation.

### N4 - Minimal operator friction

The end user's intended action is simply forwarding a WhatsApp message/document.

### N5 - Runtime validation

Untrusted webhook payloads and environment configuration should be validated at runtime.

### N6 - Automated quality gate

Every push and pull request must run automated checks for:

- TypeScript type errors
- ESLint errors
- unit tests
- Next.js production build

A failed check must be visible in GitHub Actions. Do not claim a commit is healthy unless the relevant workflow actually passes.

### N7 - GitHub Pages quality report

When GitHub Pages is available for the repository/account, the project may publish a static quality-status page generated only after all automated checks pass.

The Pages site is not the application runtime and must never contain secrets, customer documents, internal costs, environment values, or webhook payload data.

### N8 - Credentialed integration safety

Live provider integration tests must:

- be manually triggered rather than run on every push or pull request
- use synthetic data only
- keep sender allowlisting and destination Phone Number ID restrictions enabled
- avoid outbound WhatsApp messages to people
- clean up synthetic database, Storage, and Meta media fixtures
- produce redacted reports that contain no credentials, phone numbers, media IDs, or raw payloads
- remain separate from GitHub Pages

## Acceptance criteria for Milestone 1

A successful end-to-end test is:

1. User sends `Hello` to the configured WhatsApp test/business number.
2. A row appears in `public.whatsapp_messages`.
3. User forwards a PDF.
4. A second row appears.
5. The PDF appears in the private `whatsapp-media` bucket.
6. The row contains the internal Storage path.
7. Re-delivering the same webhook does not create a duplicate row.
8. The repository quality workflow passes for the tested commit.

Milestone 1 acceptance completed on 2026-09-21.

Observed real inbound evidence:

- real WhatsApp text -> Meta -> custom Vercel webhook -> Supabase: PASS
- real WhatsApp PDF/document -> Meta -> custom Vercel webhook -> media download -> private Supabase Storage -> finalized database row: PASS
- credentialed replay/idempotency and media byte-integrity checks: PASS
- repository CI for the deployed implementation: PASS


## Milestone 2A - Temporary media retention

Status: implemented in source and covered by automated tests; first scheduled live deletion observation is still pending.

### R14 - Raw media is temporary

Successfully processed inbound media must not be retained indefinitely.

The default retention target is 24 hours.

### R15 - Deletion safety

The retention job may delete only media rows that:

- have `processing_status = stored`
- still contain a non-null `storage_path`
- have `processed_at` older than the configured retention cutoff

If Storage deletion fails, the database `storage_path` must remain present so a later run can retry.

### R16 - Preserve non-file metadata

Deleting the raw Storage object must not delete the WhatsApp message row.

The current metadata, such as message type, original filename, MIME type, hash/size metadata, sender metadata, and timestamps, may remain for operational traceability.

### R17 - No invented extraction schema

The long-term direction is to retain only useful structured business data instead of raw PDFs/images.

However, the exact invoice fields and stock semantics are not yet defined. The implementation must not invent them or automatically update inventory until those rules are explicitly approved.

### N9 - Low-cost scheduled cleanup

The prototype should reuse existing low-cost infrastructure.

The scheduled cleanup runs once per day using GitHub Actions and the existing protected `integration` environment Supabase credentials.

Because scheduled workflows can be delayed, 24 hours is a retention target rather than a hard deletion SLA.


## Milestone 2B - Internal verification dashboard

Status: approved and implemented in source.

### R18 - Protected internal dashboard

The application must provide an internal mobile-first web dashboard at `/ops`.

The dashboard must not expose WhatsApp operational data without an authenticated server-side session.

For the prototype:

- `OPS_ACCESS_KEY` is the preferred dashboard login key
- when `OPS_ACCESS_KEY` is not configured, the existing `WHATSAPP_VERIFY_TOKEN` is used as a temporary bootstrap fallback
- successful login creates an HttpOnly, SameSite=Strict session cookie
- session contents are signed server-side and expire

### R19 - Private file preview

Available raw media must remain in the private Supabase bucket.

The dashboard may preview a file only by creating a short-lived signed URL server-side after session validation.

Current signed URL lifetime target: 5 minutes.

### R20 - Manual raw-file deletion

An authenticated operator may delete an available raw file before automatic retention cleanup.

The Storage object must be removed before its database `storage_path` is cleared.

The WhatsApp message row and non-file metadata must remain.

### R21 - Operational visibility

The dashboard should show, without exposing secrets:

- total accepted messages
- successfully stored messages
- currently available raw files
- failed messages
- message type
- received time
- original filename when present
- media size and MIME type
- masked sender reference
- whether the raw file is available or already deleted

### N10 - Mobile-first web UI

The verification dashboard must be usable on a phone-sized viewport so the same information architecture can later inform the mobile app.


## Milestone 2C - Structured document parsing and manual chat

Status: implemented in source; provider/live validation follows the normal quality and deployment gates.

### R22 - PDF text extraction

For inbound PDF documents, extract the existing PDF text layer without depending on one exact visual template. Apply bounded page, text, image-allocation, and timeout limits.

Retain the bounded extracted text with the structured draft so the document can be reviewed or reparsed after the raw PDF is deleted.

If no usable text layer exists, mark the draft `needs_ocr`; never invent values.

### R23 - Structured review draft

Use labels, document semantics, and reconstructed text lines rather than fixed page coordinates.

Structured fields may include document/supplier/e-Way data, consignee and buyer details, dispatch/vehicle details, totals, and product description/HSN/quantity/unit/rate/amount. Missing fields remain null and are surfaced for review.

### R24 - Review before stock

Parser output is saved as a draft. Only a complete parser draft may be marked `approved`.

Unapproved parser/OCR/AI output must not mutate inventory. For the currently approved outgoing/dispatch workflow, an approved/verified draft may proceed to the separate Milestone 2E stock-ledger checks.

### R25 - WhatsApp-style internal UI

The protected `/ops` surface should present inbound and outbound messages as a chat while keeping bill parse/review controls inside document messages.

### R26 - Manual text replies

An authenticated operator may manually send a text reply from the internal UI.

The recipient and reply-context message ID are derived server-side from the stored inbound message. Free-form replies are blocked when the latest inbound message from that WhatsApp user is older than 24 hours.

No template-message path is implemented in this milestone.

### R27 - Outbound status tracking

Persist outbound messages and update them from Meta status webhooks. Supported states are queued, sent, delivered, read, failed, and deleted. Older callbacks must not overwrite a newer status timestamp.

### R28 - Live chat viewport behavior

The protected operations chat should follow the WhatsApp Web interaction model on desktop:

- use the available viewport height instead of growing the whole document
- keep the conversation list and selected timeline independently scrollable
- keep the reply composer visible at the bottom of the selected chat
- open a selected conversation at its newest message
- automatically refresh visible chat data without requiring the operator to press a manual Refresh button
- do not force-scroll to the bottom after the operator intentionally scrolls up to inspect history

The current low-cost implementation uses a short visible-tab refresh interval rather than exposing Supabase server credentials or opening an unauthenticated realtime subscription.

### R29 - Accurate outbound failure feedback

A failed or queued duplicate reply request must never be displayed as successfully sent.

When Meta rejects a send request, persist only bounded, redacted provider diagnostics suitable for internal troubleshooting. Never persist access tokens, full phone numbers, raw payloads, or provider trace identifiers.

### N11 - Local parsing remains the first pass

Selectable-text PDF parsing remains local/server-side. A later explicitly approved verification milestone may use a low-cost external verifier, but external AI must never become the sole authority for operational data.

## Milestone 2D - Fail-closed verified document automation

Status: approved for implementation. Provider/live validation is separate from source completion.

### R30 - Deterministic parser remains primary

The existing semantic PDF parser remains the first extraction pass. Do not replace it with an AI-only parser.

### R31 - Independent Groq verification

When document automation is enabled, bounded extracted text may be sent server-side to Groq using the configured small production model.

The verifier must use strict JSON Schema output and independently extract every persisted structured document field and every line-item field. The deterministic parser result itself must not be supplied as the answer to copy.

### R32 - Fail-closed agreement

Automatic document recording is allowed only when:

- the deterministic parser is complete enough for review
- the Groq response passes local runtime validation
- every persisted structured field agrees after documented normalization
- item count and every item description/HSN/quantity/unit/rate/amount agree
- deterministic line arithmetic checks pass
- the document is not cancelled

Any mismatch, missing text layer, timeout, rate limit, provider error, invalid output, or incomplete parser state must become `review_required`. Never choose whichever extractor looks more likely.

### R33 - Auto-record is the stock-processing gate, not the stock decision

A safely verified document may move to the document workflow state `recorded` and parser state `approved`.

Those states mean the document data is accepted. They do not by themselves prove that inventory can move. After recording, the separate Milestone 2E stock engine may create outgoing Stock OUT only if company/product identity, unit, quantity, available balance, idempotency, and all-or-nothing checks pass. Automatic Stock IN remains out of scope.

### R34 - Automatic WhatsApp summary

While the customer-service window is open, a safely verified inbound PDF may trigger one idempotent transactional WhatsApp summary containing only the operational fields needed for quick review.

The summary must report stock state accurately: applied when Stock OUT succeeds, pending/blocked when stock cannot safely move, and reversed after a successful cancellation reversal.

### R35 - Interactive correction controls

The automatic summary may include WhatsApp interactive Edit/Delete controls.

Edit should use a bounded menu where possible. After choosing a field, the operator may type only the corrected value. Corrections must be validated and recorded as a human override with previous/new values retained in the audit log.

### R36 - Audit-safe delete

Delete must require an explicit destructive confirmation.

Delete means cancellation from the active document workflow. It must not hard-delete the structured document or its audit history.

If Stock OUT was already applied, the system must restore the document's net deduction through immutable reversal entries before marking the workflow cancelled. If a safe reversal cannot be completed, cancellation must fail closed.

### R37 - Sender binding

Interactive action IDs are not authorization by themselves.

Every Edit/Delete/correction action must be resolved server-side and rejected unless the target document belongs to the same stored WhatsApp sender that submitted the interaction.

### R38 - Automatic outbound idempotency

Automatic summaries, review notices, edit prompts, and delete confirmations must use deterministic request identifiers so webhook retries cannot create duplicate sends.

### R39 - Feature flag and secret isolation

Document automation must be disabled by default.

It may be enabled only when `DOCUMENT_AUTOMATION_ENABLED=true` and a server-side `GROQ_API_KEY` is configured. The Groq key must never be exposed in browser code, logs, reports, or committed source.

### N12 - AI privacy and cost boundary

Only bounded extracted text is sent to the verifier; the raw PDF is not sent to Groq in this milestone.

Before real business documents are processed through Groq, enable Zero Data Retention in Groq Data Controls. Keep the configured model and request volume compatible with the approved low-cost/free-tier prototype unless the user explicitly approves paid usage.

### N13 - Provider failure must not break inbound storage

Once the original WhatsApp message/media is safely stored, Groq verification or automatic WhatsApp-send failure must not retroactively mark that stored inbound media as failed. The document workflow should fail closed to review while the original ingestion record remains intact.


## Milestone 2E - Opening Stock and outgoing inventory ledger

Status: approved for implementation. Live WhatsApp/provider acceptance remains separate.

### R40 - One-time Opening Stock

The protected operations UI must provide a one-time Opening Stock entry for each company/product/unit combination.

Opening Stock must:

- be positive
- create or reuse an explicit company identity
- create an explicit canonical product identity
- retain unit and optional HSN/SAC
- create an immutable positive ledger movement
- refuse to silently overwrite an existing opening entry for the same product

### R41 - Canonical identity and aliases

Stock identity is scoped by company.

Canonical company/product names are operator-controlled. Normalization may remove case/separator differences for lookup, but fuzzy similarity must never create a mapping automatically.

Approved aliases may be saved after an operator explicitly selects a company/product through the WhatsApp workflow.

### R42 - Approved outgoing bill means Stock OUT

The currently handled bill/PDF is an outgoing/dispatch document.

After its document data is approved/verified, the system must attempt Stock OUT for every line item.

Automatic Stock OUT requires:

- an identified stock company
- an approved canonical/alias product match
- matching normalized unit
- positive quantity
- optional HSN compatibility when both sides have HSN
- sufficient current balance

### R43 - Full-bill atomicity

Stock OUT is all-or-nothing for a bill.

If any line item is unknown, ambiguous, invalid, has a unit/HSN conflict, or exceeds available stock, no Stock OUT row from that bill may be inserted.

The user must never receive a partially deducted bill.

### R44 - Idempotent stock movements

Repeated Meta webhook delivery, PDF reprocessing, page refresh, or provider retry must not deduct stock twice.

Each opening, Stock OUT, correction, and reversal movement needs a stable idempotency key or equivalent uniqueness guarantee.

### R45 - Current stock from immutable ledger

Do not maintain current quantity by silently overwriting a mutable balance column.

Current stock is derived from ledger deltas:

`Opening + future Stock IN + corrections + reversals - Stock OUT`

Only the movement types explicitly approved in the current milestone may be created.

### R46 - WhatsApp-first mismatch resolution

A company/product mismatch must be surfaced to the same WhatsApp sender, not only in the dashboard.

The sender may receive an interactive list of existing stock companies/products. Suggestions may be ranked by normalized similarity, but the system must not auto-select the suggestion.

After selection:

- verify the selected target belongs to the correct company/unit
- bind the action to the original sender server-side
- save the approved alias
- retry the complete bill atomically

### R47 - Insufficient stock

If required quantity exceeds available quantity:

- deduct nothing from the bill
- persist a safe blocked stock status
- notify the WhatsApp sender with required and available quantities
- allow the operator to correct or cancel the bill

Negative stock must not be created silently.

### R48 - Quantity edit after Stock OUT

When an already-deducted bill quantity changes, do not rewrite historical Stock OUT rows.

Create an immutable correction movement equal to the difference and update the structured bill quantity only when the correction is safe.

If an increased quantity requires more stock than available, reject the correction and keep the previous quantity/stock unchanged.

### R49 - Delete/cancellation reversal

If a bill with applied Stock OUT is deleted/cancelled, restore the net document deduction through reversal ledger entries first.

Only after a safe reversal may the document workflow be marked cancelled.

If no deduction had been applied, cancellation may proceed without a stock reversal.

### R50 - Opening Stock UI security

`/ops/stock` and its mutation endpoint are internal operations surfaces and must require the same protected operations session and same-origin POST protection as other internal mutations.

Stock master/ledger tables must not be directly accessible to `anon` or normal `authenticated` browser roles.

### R51 - Stock-IN remains separate

This milestone does not infer receiving/Stock IN from the current outgoing bill.

A real stock-IN document sample and explicit receiving rules are still required before automatic Stock IN is implemented.

### R52 - Opening Stock GSTIN input safety

GSTIN is optional for manual Opening Stock setup.

When supplied, the server must:

- normalize NFKC-compatible clipboard characters
- resolve only a standard 15-character GSTIN-shaped value
- allow one unambiguous GSTIN token to be extracted from surrounding copied label text
- reject multiple GSTIN candidates rather than guess
- never log the GSTIN value on validation failure
- expose only safe diagnostic metadata such as lengths/counts/shape validity when troubleshooting


### R53 - SPA-like stock mutations

The protected Stock page must not require a browser document reload for normal Opening Stock or current-stock adjustment actions.

Use client-side mutation requests and refresh server-rendered stock data through the Next.js App Router after a successful mutation.

A hard navigation fallback may remain available for non-JavaScript form compatibility, but the normal authenticated operator path should preserve the single-page feel.

### R54 - Manual current-stock adjustment

An operator may set the current physical quantity of an existing stock product.

The system must:

- accept a target quantity greater than or equal to zero
- lock the product while calculating its current derived balance
- compute only the delta needed to reach the target
- append an immutable `adjustment` ledger movement when the delta is non-zero
- return `no_change` without writing a movement when the target already equals the balance
- reject/fail closed if the existing derived balance is already negative/inconsistent
- never rewrite Opening Stock, Stock OUT, correction, or reversal history
- keep the operation server-only and protected by the existing operations session and same-origin request check

### R55 - Adjustment idempotency and concurrency

Manual stock adjustments must remain safe if the operator double-clicks, the browser retries, or two requests serialize close together.

The database operation must lock the product row before deriving the balance. Replaying the same idempotency key must not add a second delta; a later request targeting an already-achieved quantity must return `no_change`.


### R56 - Mobile-first professional stock UI

The protected stock-management surface must be designed mobile-first.

Normal mobile order:

1. current inventory and quick Adjust actions
2. add-opening-stock setup below it

On wider screens the same semantic sections may be rearranged for efficiency.

The stock UI must:

- use a light theme scoped to the stock surface
- use shared design tokens for background, surface, text, muted text, borders, accent, focus, spacing, and radii
- keep form controls and primary actions at least approximately 44px high for touch use
- avoid horizontal-table dependence on narrow screens
- preserve readable labels and quantities without truncating critical stock values
- avoid decorative gradients/heavy card styling that reduces operational clarity
- add no new design-system dependency unless explicitly approved

This requirement is visual/interaction-only and must not weaken the existing stock ledger, authentication, or mutation rules.


### R57 - Mobile Add Stock bottom sheet

On narrow/mobile stock screens, adding a new stock product must be a secondary action exposed through a floating **Add stock** button rather than a permanently visible long form.

The mobile interaction must:

- open the existing Opening Stock form in a bottom sheet/drawer
- reuse the same server validation and mutation path as desktop
- keep Current stock visible as the primary page task while the sheet is closed
- support backdrop close, an explicit close control, and Escape-key close
- prevent background-page scrolling while the sheet is open
- keep the primary Save action reachable near the bottom of the sheet
- respect mobile safe-area insets
- return focus to the Add stock trigger after closing when practical
- avoid adding a new UI/design dependency

Desktop/wide layouts may continue to render the Opening Stock form inline.


### R58 - GSTIN is mandatory for Opening Stock companies

Every company used by the Opening Stock workflow must have a valid standard 15-character GSTIN.

Rules:

- creating a new stock company requires GSTIN
- selecting an existing company may reuse its stored GSTIN without retyping it
- an existing stock company without GSTIN must be blocked from new Opening Stock entries
- a supplied GSTIN that conflicts with the selected company's stored GSTIN must be rejected
- database schema must enforce `stock_companies.gstin NOT NULL`
- the stock UI may disable the GSTIN field when an existing GSTIN-backed company is selected, but server/database validation remains authoritative

This requirement applies to inventory company identity and must not be bypassed by client-side form manipulation.
