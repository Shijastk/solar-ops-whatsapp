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
