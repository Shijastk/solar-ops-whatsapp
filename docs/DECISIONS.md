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

- `* = false`
- `main = true`

Vercel evaluates matching branch rules so the explicit `main = true` rule allows main while other branches remain disabled.

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
