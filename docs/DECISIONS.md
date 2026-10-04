# Decisions

## D001 - Preserve the WhatsApp workflow

Decision: The operator will not be required to enter the same information into another app.

Reason: A previous stock/dispatch app was abandoned because manual duplicate data entry created too much friction.

## D002 - WhatsApp is the initial user interface

Decision: The first interaction is simply forwarding a message/document to the Solar Ops WhatsApp destination.

Reason: This matches the existing behavior and reduces adoption risk.

## D003 - Internal operations system before customer SaaS

Decision: Build an internal ingestion/operations foundation first.

Reason: The business value is the operational network and coordination, not forcing client companies to adopt software.

## D004 - Inbound first, no automatic replies

Decision: Milestone 1 receives and stores messages only.

Reason: It reduces cost, permissions, complexity, and accidental customer-facing behavior.

## D005 - Supabase as persistence layer

Decision: Use Supabase Postgres for metadata and private Storage for media in the prototype.

Reason: It offers a simple low-cost managed backend and the user already understands the ecosystem.

## D006 - Next.js + TypeScript

Decision: Use Next.js App Router and TypeScript rather than a static HTML/CSS project.

Reason: The solution needs server endpoints, provider integrations, validation, and a maintainable path to a future operational dashboard.

## D007 - Vercel as prototype runtime

Decision: Target Vercel Functions for the initial hosted webhook.

Reason: It integrates with GitHub and supports Next.js server routes.

Note: Hosting-plan suitability for long-term commercial production must be reviewed separately.

## D008 - Private media

Decision: Incoming PDFs/images/business documents are private by default.

Reason: They may contain commercially sensitive information.

## D009 - Idempotency by WhatsApp message ID

Decision: `whatsapp_message_id` is unique.

Reason: Webhook providers may retry delivery.

## D010 - No OCR-driven stock update without confirmation

Decision: Future OCR may create a draft, but it must not silently mutate stock until a later explicit business rule is approved.

Reason: Invoice/OCR mistakes could corrupt operational inventory.

## D011 - Do not expose internal margins by default

Decision: Future customer-facing views, if added, must not expose porter/driver/vendor cost or internal margin unless the business intentionally chooses to disclose it.

Reason: Internal procurement/operating data is not inherently customer-facing information.

## D012 - Pin Meta Graph API v26.0

Decision: The prototype is intentionally pinned to Meta Graph API `v26.0`.

Evidence recorded on 2026-09-21: Meta's version table supplied for this project lists v26.0 as released on July 29, 2026, with expiration date still TBD. The preceding v25.0 expires July 29, 2028.

Reason: Provider-version assumptions must not be invented. The repository should use an explicitly selected version rather than silently inheriting an older default.

Follow-up: Re-check Meta's official version table before production rollout and when Meta publishes the v26.0 expiration date.

## D013 - GitHub Actions is the quality gate; Pages is only the report

Decision: Use GitHub Actions for automated typecheck, lint, tests, and production build. Use GitHub Pages only to publish a non-sensitive static report after those checks pass.

Reason: GitHub Pages is static hosting and cannot execute the server-side WhatsApp webhook. Treating Pages as backend testing would give false confidence.

Security condition: the Pages artifact may contain only generic quality metadata. It must never publish secrets, WhatsApp payloads, phone numbers, customer documents, or internal commercial data.


## D014 - Manual credentialed provider integration harness

Decision: Add a manual-only credentialed integration workflow that uses synthetic test data to exercise the deployed webhook, Meta media API, Supabase database, private Storage, idempotency, and cleanup.

Reason: Unit tests and Meta's dashboard sample cannot prove the complete provider path. A controlled synthetic media fixture can test the real Meta media upload/retrieve/download APIs without publishing customer data or sending a WhatsApp message to a person.

Safety constraints:

- the workflow uses `workflow_dispatch` only
- sender allowlist and destination Phone Number ID checks must remain enabled
- credentials are supplied only through GitHub Actions secrets
- a generated synthetic PDF is used instead of a real document
- cleanup is mandatory in the GitHub workflow
- reports are redacted artifacts and are never published to Pages
- a real inbound WhatsApp delivery remains a separate acceptance test


## D015 - Publish a first-party privacy policy on the application domain

Decision: Serve the Solar Ops privacy policy from the same deployed application at `/privacy`.

Reason: Meta's publish flow requires a public privacy-policy URL, and hosting the policy on the existing Vercel application avoids a separate service or dependency.

The policy must describe actual current behavior only. It must disclose the WhatsApp/Meta, Vercel, and Supabase processing path, avoid unsupported legal promises, and never include credentials or private operational data.


## D016 - Publish the Meta app and subscribe it to the test WABA for final inbound acceptance

Decision: Publish the Meta app and explicitly subscribe it to the Test WhatsApp Business Account before declaring Milestone 1 complete.

Reason: Webhook configuration and synthetic provider tests did not prove that Meta itself would deliver real inbound callbacks.

Observed result on 2026-09-21:

- WABA subscription returned `{"success": true}`
- a real inbound text was delivered to the custom webhook and stored
- a real inbound PDF/document was delivered to the custom webhook and stored
- therefore Milestone 1 acceptance is complete


## D017 - Raw WhatsApp media is temporary

Decision: Keep successfully processed WhatsApp media in private Supabase Storage only temporarily, with a default retention target of 24 hours.

Reason: The operational value is in the useful data derived from a bill/document, not in retaining every raw PDF indefinitely. Short retention controls Storage growth and reduces unnecessary data retention.

Implementation choice:

- a daily GitHub Actions maintenance workflow reuses the existing protected Supabase credentials
- it queries only successfully stored rows older than the cutoff
- it deletes the private Storage object first
- only after successful object deletion does it clear the database `storage_path`
- failed deletions leave the path intact for retry
- reports contain counts/timing only, never filenames, paths, phone numbers, or customer document content

Structured selectable-text PDF fields are now defined in Milestone 2C. OCR for scanned documents and inventory mutation semantics remain separate explicit decisions.


## D018 - Build a protected mobile-first web dashboard before the mobile app

Decision: Add an internal web dashboard first so the actual WhatsApp/Supabase data flow can be visually verified before building the mobile app.

Reason: The web dashboard reuses the existing Next.js deployment and server-side Supabase access, making it the lowest-risk way to validate the operational information architecture.

Security decisions:

- keep the Storage bucket private
- generate file preview links only after authenticated server-side checks
- signed preview URLs expire after 5 minutes
- never expose Supabase server credentials to the browser
- mask sender phone numbers in the dashboard
- allow manual raw-file deletion while preserving message metadata

Prototype authentication uses an optional dedicated `OPS_ACCESS_KEY`. If that is not configured, the existing webhook verify token is accepted only as a temporary bootstrap fallback. A future mobile app should move to dedicated user authentication rather than depending on this fallback.


## D019 - Parse by semantic anchors, not one fixed bill template

Decision: Reconstruct PDF text lines and parse labels/anchors instead of binding extraction to fixed page coordinates.

Reason: A company may keep a broadly similar format while spacing, page flow, optional fields, customer data, item count, or document variants change.

The bounded extracted text is retained because it is much smaller than the raw PDF and allows later review/reparsing after raw-file cleanup. Image-only PDFs are marked `needs_ocr`.

## D020 - Parser approval does not equal stock mutation

Decision: Structured parser drafts can be reviewed and marked approved, but approval does not alter inventory.

Reason: Source documents identify goods and quantities but do not fully define this godown's opening-balance, stock-IN, stock-OUT, return, cancellation, and correction rules.

## D021 - Manual WhatsApp replies only inside the service window

Decision: Add operator-triggered text replies from the protected UI using the inbound message as Meta reply context.

The backend derives recipient/context from stored rows, enforces the latest-inbound 24-hour service window, persists outbound state, and consumes delivery-status webhooks.

Automatic replies and template messaging outside the service window are not part of this milestone.


## D022 - Automatic Vercel deployments run only from main

Decision: Automatic Vercel Git deployments are disabled for all branches except `main`.

Implementation:

`vercel.json` uses Vercel's documented `git.deploymentEnabled` branch rules:

- `** = false`
- `main = true`

The recursive `**` pattern is required because development branches use names such as `feature/...`, `fix/...`, and `chore/...`. A single `*` pattern does not cover those nested branch names. Vercel evaluates matching branch rules so the explicit `main = true` rule allows main while other branches remain disabled.

Reason: During active development, many small feature-branch commits created Preview deployments and exhausted the Hobby build/deployment quota before the final production release.

Release workflow:

1. create a feature branch
2. let GitHub Actions run typecheck, lint, unit tests, and production build
3. open a pull request
4. require PR CI to pass
5. squash-merge to `main`
6. let the single `main` push create the automatic Vercel production deployment
7. verify health/runtime logs after the deployment reaches READY

A Preview deployment may still be created manually when one is genuinely needed for UI/provider verification. It should not be created for every development commit.


## D023 - Keep operations updates automatic without exposing Supabase realtime access

Decision: The protected `/ops` UI automatically refreshes server-rendered data on a short interval while the browser tab is visible, and scrolls a newly opened conversation to its newest message.

Reason: The current dashboard uses a custom HttpOnly operations session and server-only Supabase admin access. Adding a browser-side Supabase Realtime subscription would require a separate client authorization model and must not be implemented by exposing the server secret or weakening RLS.

The polling layer is intentionally small, pauses effectively when the tab is hidden, and preserves the operator's scroll position when they move upward to inspect history. This is a near-live UI behavior, not a claim of true push realtime.

## D024 - Use Groq only as an independent second verifier

Decision: Keep the deterministic semantic parser as the first extractor and use Groq only as an independent second extraction pass.

Reason: A single LLM output cannot provide a 100% semantic-accuracy guarantee. Requiring normalized agreement between two different extraction methods makes automatic acceptance stricter and allows uncertainty to fail closed.

The selected default verifier is `openai/gpt-oss-20b` because current Groq documentation lists it as a production model with strict JSON Schema structured output support and it fits the prototype's low-volume cost target.

## D025 - Verify the entire persisted draft before auto-recording

Decision: Automatic `recorded/approved` state requires agreement across every persisted structured document field and every line-item field, plus deterministic arithmetic checks.

Reason: Verifying only the few fields displayed in the WhatsApp summary could falsely imply that unverified hidden fields were approved.

Any mismatch sends the document to review. False review is preferred over false automatic acceptance.

## D026 - Automatic document summary is approved, general auto-messaging is not

Decision: A verified inbound PDF may automatically receive one transactional summary with Edit/Delete controls inside the active customer-service window.

Reason: This follows the existing WhatsApp workflow and removes the need for a confirmation reply on every correct bill.

This approval does not authorize marketing, arbitrary automatic replies, or template messaging outside the service window.

## D027 - Human corrections override verification but remain auditable

Decision: A correction explicitly entered by the operator after selecting an Edit field is stored as `manual_override`, with previous/new values in `document_actions`.

Reason: Human correction is intentional business input. It should not be mislabeled as AI-verified, and history must remain inspectable.

## D028 - Delete means workflow cancellation, not destructive data deletion

Decision: The WhatsApp Delete action requires confirmation and changes the document workflow to `cancelled`.

Reason: Hard deletion would remove the evidence needed to understand later corrections, duplicates, or future stock reversals. Cancellation removes the record from active work while preserving audit history.

## D029 - Stock automation remains blocked

Decision: Neither deterministic parsing, Groq verification, automatic recording, human edits, nor Delete may mutate inventory.

Reason: The current document represents an outgoing/dispatch flow, while a separate stock-IN document sample and rules for opening balance, returns, cancellations, corrections, product identity, units, and negative stock have not yet been defined.


## D030 - Opening Stock option A is the initial inventory source

Decision: The operator manually enters existing quantity once per company/product/unit through the protected Stock screen.

Reason: The current system has no historical receiving ledger from which the pre-existing warehouse balance can be reconstructed safely.

Opening Stock is not repeatedly edited; later changes are represented by explicit movements.

## D031 - Current handled bill is outgoing/dispatch Stock OUT

Decision: Once the current bill's structured data is approved/verified, its quantities may reduce existing stock.

Reason: The user explicitly confirmed that this document represents goods being taken from the godown.

This decision does not define future receiving/Stock IN documents.

## D032 - Stock ledger is immutable and derived

Decision: Store inventory movements rather than a mutable current-stock number.

Reason: Duplicate prevention, corrections, cancellation, and later audits are safer when each movement has an immutable reason and idempotency key.

Current balance is the sum of ledger deltas.

## D033 - A bill is all-or-nothing for Stock OUT

Decision: Never partially deduct a multi-line bill.

Reason: Partial success would make the WhatsApp document and warehouse balance disagree. Any unresolved product, invalid quantity/unit, HSN conflict, or insufficient balance blocks the whole bill.

## D034 - Spelling similarity is suggestion-only

Decision: Normalization/fuzzy similarity may rank existing companies/products for WhatsApp selection, but must never auto-map a new spelling.

Reason: A wrong product identity can corrupt inventory even when quantities were parsed correctly.

An explicit operator selection creates the alias for future automatic exact alias matches.

## D035 - Stock exceptions are WhatsApp-first

Decision: Company/product mapping and insufficient-stock warnings must be surfaced to the sender in WhatsApp.

Reason: The product principle is to follow the existing WhatsApp workflow rather than require daily dashboard monitoring.

The dashboard remains an internal setup/audit surface.

## D036 - Quantity edits and Delete use ledger corrections/reversals

Decision: An edit after Stock OUT writes a correction delta; Delete restores the net deduction with a reversal before cancelling the workflow.

Reason: Rewriting or deleting historical movements would destroy auditability and make duplicate/retry behavior difficult to reason about.


## D037 - Keep the dashboard hybrid rather than a pure client SPA

Decision: Keep Next.js App Router server rendering for protected data, but use client components for frequent operator mutations and `router.refresh()` for fresh server data.

Reason: This preserves server-only Supabase credentials and authorization while removing the full-document reload feel from normal stock operations.

The application is therefore a hybrid App Router application, not a traditional multi-page site and not a fully client-rendered SPA.

## D038 - Manual stock correction is a ledger adjustment

Decision: Editing an existing current stock quantity appends an `adjustment` movement equal to target minus current derived balance.

Reason: The physical count may need correction, but overwriting the original opening balance or historical bill movements destroys auditability.

A target of zero is valid; a negative target is not.


## D039 - Stock UI uses scoped light design tokens

Decision: The stock-management surface uses a light operational theme with CSS custom-property design tokens scoped under `stockShell`.

Reason: Stock entry and physical-count correction are form-heavy operational tasks. A restrained light surface with explicit borders, readable hierarchy, and consistent focus states is easier to scan on mobile than the previous dark card-heavy presentation.

The WhatsApp operations chat remains visually separate; the stock theme must not recolor the chat surface.

No external UI/design library was added.

## D040 - Current inventory comes first on mobile

Decision: On narrow screens, Current stock appears before the Add opening stock form. On desktop, CSS grid reorders the same sections to setup-left / inventory-right.

Reason: Adjusting existing stock is expected to be the more frequent mobile task after initial setup, so it should require less scrolling.


## D041 - Mobile Opening Stock uses a bottom sheet

Decision: On mobile, the Opening Stock form is launched from a floating **Add stock** action and presented as a bottom sheet. Desktop keeps the same form inline.

Reason: Current inventory and Adjust are the frequent day-to-day tasks after setup. Keeping the long creation form permanently in the mobile document flow adds scrolling and visual weight.

The sheet reuses the existing form and mutation path; this is an interaction/layout decision, not a second stock workflow.


## D042 - Stock companies require GSTIN

Decision: Every stock company must have a valid GSTIN.

Reason: Company name spelling alone is not strong enough for inventory identity. GSTIN provides a stable company-level key for Opening Stock and later bill matching.

New companies cannot be created without GSTIN. Existing companies reuse their saved GSTIN; operators do not need to retype it for each product.


## D043 - Mobile app talks to Solar Ops backend, not directly to privileged Supabase

Decision: the Flutter app uses authenticated `/api/mobile/v1/*` endpoints on the existing Solar Ops Next.js backend.

The mobile login exchanges the existing operations access key for the same signed, expiring operations-session format used by the protected web surface. The app stores only that short-lived session token. Supabase service-role access remains server-side.

This keeps inventory/document rules centralized and avoids duplicating privileged database logic in the APK.

## D044 - Operational questions use a deterministic fast path before AI

Decision: inbound operator questions with a clear supported intent are answered from stored structured data using narrow database queries. Groq is not called for these exact intents.

The initial intents are today's PDF-bill count, pending-bill count, latest-bill summary, and exact canonical/approved-alias stock balance.

Reason: the operational source of truth is already in Postgres after ingestion. Re-reading PDFs, loading broad history, or calling an LLM for simple counts/balances would add latency, token cost, and new failure modes without adding accuracy.

Safety boundaries:

- document Edit sessions are resolved before query routing
- stock identity remains exact/fail-closed; fuzzy similarity is still suggestion-only
- automatic query replies stay inside the existing WhatsApp customer-service window and use the existing outbound idempotency layer
- this decision extends D026 only for direct replies to bounded operator questions; it does not authorize marketing, unsolicited messaging, or arbitrary AI-generated automation
- future AI intent fallback may interpret language, but the final facts must come from targeted database retrieval

## D045 - Use Groq only to resolve bounded query intent after deterministic routing

Decision: Groq may be used as a second-stage language classifier only after the deterministic WhatsApp query parser fails and only for text that contains an operational domain hint.

The classifier receives at most 500 characters from the current message and returns only a strict supported-intent schema plus an optional product phrase. It never receives raw PDFs, stored document text, database history, or stock-ledger data for this task.

Reason: Malayalam/Manglish wording can vary enough that exact phrase rules alone would create unnecessary operator friction, but sending every message or the full operational context to an LLM would add cost, latency, privacy exposure, and new failure modes.

Database retrieval remains authoritative. AI decides only which bounded read to attempt; it does not calculate balances, select fuzzy product identities, mutate stock, or generate the factual result.

## D046 - Fuzzy matching is allowed for read-only stock answers, not stock mutation

Decision: a WhatsApp stock-balance question may use indexed typo-tolerant product search when exact canonical/approved-alias matching fails.

This does not change D034 for inventory mutation. Fuzzy search does not save aliases, approve a bill, or select a product for Stock OUT. Numeric/model tokens are guarded, weak matches are rejected, and multiple plausible products are returned separately.

Reason: requiring exact spelling adds unnecessary operator friction for read-only questions, while silently changing inventory identity would be unsafe.

## D047 - Product creation identity is deterministic and cannot be AI-overridden

Decision: opening-stock product identity uses local deterministic normalization plus a company/unit-scoped indexed candidate search. AI is not part of this decision.

Hard-equivalent wording variants such as singular/plural inventory nouns cannot be bypassed with the existing `allowSimilarProduct` confirmation. The confirmation remains available only for soft similarity warnings where the products may genuinely be distinct.

Reason: inventory identity is an accounting boundary. Local deterministic rules are faster, cheaper, reproducible, testable, and safer than model inference for this job.

## D048 - Inventory uses an event ledger, not an availability gate

Decision: verified outgoing bills write immutable negative stock movements even when the current balance is zero or negative. Stock availability no longer blocks the historical fact that goods went out.

Products and companies may be provisioned from verified structured bill data using deterministic identity rules. Manual incoming stock is represented by positive ledger movements. Current balance is the sum of movements and may temporarily be negative when incoming/opening data has not been entered yet.

Reason: the application must preserve what physically happened first and allow stock data to be completed later, while retaining an auditable bank-style history.

## D049 - AI does not write WhatsApp operational prose and is not the default PDF verifier

Decision: operational WhatsApp responses are fixed backend templates. Clean documents use deterministic local verification first; Groq is called only when deterministic safety checks do not establish a safe result.

Reason: deterministic paths are faster, cheaper, reproducible, and easier to audit. AI remains useful for genuinely ambiguous extraction/verification, not routine status text or every clean bill.

## D050 - Exact operational Q&A uses structured retrieval, not vector RAG

Decision: stock, bill, trip, driver, date-range counts, and other transactional facts are answered from whitelisted database queries/RPCs. Natural-language AI may classify intent, period, or entity, but it never supplies the factual value itself.

Vector RAG is intentionally not used for exact operational balances/counts because approximate semantic retrieval can omit rows, return stale text, and add latency. RAG may be added later only for genuinely unstructured content such as notes or long free-text documents.

## D051 - Every allowed inbound WhatsApp message receives a response

Decision: text uses deterministic commands/queries first, then a bounded conversational fallback. Voice is transcribed and passed through the same text engine. Unsupported media receives a short acknowledgement. PDFs inside an open trip receive an immediate lightweight receipt while heavy parsing/verification continues independently.

## D052 - Driver selection must not wait for bill verification

Decision: after the operator sends done/ശരി/complete, bill collection closes and the driver picker is returned immediately. Pending bill parsing/verification may continue while the operator selects a driver. If processing is still pending after driver selection, the trip auto-finalizes when the last reserved bill finishes.

Reason: WhatsApp round-trip latency should not create an avoidable extra waiting step.




## 2026-10-03 mobile simplification and duplicate repair

The mobile client uses three primary sections: Trips, Stock and History. Company switching filters each section by canonical company ID or exact GSTIN; it is an operations view switch within the shared operator account. Drivers and WhatsApp conversations live in a small menu. Direct PDF upload (maximum 4 MiB), grouping uploaded or existing bills into trips, driver creation/assignment, stock counting, bill review, quantity/vehicle/number correction and cancellation remain available. Older bills are searchable and retrievable on demand rather than included in every launch.

`/api/mobile/v1/home` is the compact launch API; the existing bootstrap API remains compatible with older clients and loads WhatsApp history only when requested. New write APIs require the same signed bearer authentication. Bill corrections/cancellation and their audit entries commit in one Postgres transaction. Trip attachment and closing serialize on the same trip row; closing requires a driver, parsed approved stock-posted bills and consistent vehicle identity. Ready means ready to dispatch, not delivered.

Mobile setup issues a 90-day signed session, stored with the compact cache in encrypted device storage. Cached data renders before network refresh and displays its sync timestamp. Offline data is never treated as confirmation of a server write. A 401 clears token and cache. Device authentication is optional (off by default), using fingerprint or the existing OS PIN/pattern; server authentication is retained. Shared HMAC sessions have no per-device revocation; secret rotation invalidates them.

Exact repeated PDF text reuses the existing approved active business draft while retaining the new inbound message. Different PDFs for the same normalized GSTIN+bill number or e-way number are blocked by transaction-level identity locks before catalog creation, inferred receipts or stock-out. Historical unposted copies are classified as duplicates without deleting records or replaying real stock. Identity claims survive cancellation; reuploading a cancelled bill does not silently undo it. Invoice numbers reused across financial years require review; this release keeps the existing conservative GSTIN+number identity rule.

Company aliases now accept `document`, matching the verified ingestion code and product-alias constraint. Catalog failures persist a stock error. Duplicate replies are short Already uploaded notices. Raw-file cleanup runs hourly after the 24-hour threshold using the Storage API; message metadata, extracted text, structured items, trip links and the immutable ledger remain. GitHub schedule delays mean deletion is approximate.

Migration ordering note: earlier repository migrations have timestamps later than their observed application time. The repair file is ordered after them so a fresh replay cannot overwrite the restored guard. Production was applied through the Supabase migration connector.


## 2026-10-04 — Malayalam-first voice clarification
Production voice evidence showed a Malayalam stock question transcribed into unrelated English words with its model number absent. Explicit `language=ml` and a Malayalam domain prompt replace language auto-detection and the English-only prompt. Retain Whisper Turbo and existing request limits. Unresolved voice queries return bounded heard-text clarification instead of general chat fallback. No missing model number, product mapping or balance is inferred. Groq documents explicit input language as improving accuracy/latency: https://console.groq.com/docs/speech-to-text .


## 2026-10-04 — Compact mobile manual dispatch
Manual dispatch uses a dedicated trip mode and product/quantity rows; an atomic service-role-only RPC writes the trip and immutable manual_out ledger once per client request UUID. No fake WhatsApp message or PDF draft is created. Product identity is company-scoped; canonical recorded bill names are catalogue suggestions, not physical balances. PDFs remain a secondary bill-trip path. Inferred receipts no longer establish a known physical balance; an explicit later physical count does. Zero-delta physical confirmation is an audited adjustment. Add Stock on a selected existing product records positive quantity received; current-stock correction remains separate.
Mobile operations return the changed trip so the app renders it without a full-home refresh. Driver-only updates skip document naming work. Old clients keep their existing APIs. Full-IST-day outgoing quantities come from an aggregate RPC, not the launch page. History groups recent linked bills into trip rows; older bill search remains. The mobile session remains 90 days and restores from encrypted storage; no permanent unauthenticated access is introduced. Real-phone latency/biometrics remain unverified. The CLI-generated migration timestamp is moved after the prior repair filename, which was already later than the execution clock, to preserve fresh-replay ordering.
