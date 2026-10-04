# Known Issues and Open Concerns

## K001 - Custom Meta -> Vercel -> Supabase Milestone 1 path verified

Resolved on 2026-09-21.

Verified:

- Meta custom webhook GET verification succeeds
- Meta app is published
- app subscription to the Test WhatsApp Business Account succeeds
- real inbound WhatsApp text reaches the custom webhook and is stored
- real inbound WhatsApp PDF/document reaches the custom webhook and is stored
- private Supabase media Storage is verified
- credentialed media byte-integrity and cleanup checks pass
- replay/idempotency checks pass

Milestone 1 is complete.

## K002 - Vercel deployment is established

Resolved on 2026-09-21.

Verified:

- Vercel project `solar-ops-whatsapp` exists
- framework is Next.js
- production deployment state is `READY`
- stable alias is `https://solar-ops-whatsapp.vercel.app`
- Meta webhook GET verification reached the deployed route and returned HTTP 200
- Meta dashboard POST test reached the deployed route
- runtime configuration is valid

## K003 - Supabase database and private media storage are verified through the credentialed harness

Verified:

- `supabase/schema.sql` was applied by the user
- `public.whatsapp_messages` exists
- private `whatsapp-media` bucket exists
- Meta dashboard sample text was written to the table
- signed synthetic text persists through the deployed webhook
- Meta media can be uploaded/retrieved/downloaded with the current system-user setup
- a signed synthetic document webhook causes the deployed endpoint to download the real Meta media bytes and store them in `whatsapp-media`
- the database row contains the expected Storage path
- downloaded Supabase Storage bytes match the original synthetic PDF by SHA-256
- synthetic database and Storage fixtures are cleaned up after the run

A real Meta-delivered inbound PDF has also been verified through the custom deployed webhook.

## K004 - Meta access token lifecycle

The current Meta test setup may use a temporary token.

Before long-lived operation, token lifecycle and the appropriate production credential setup must be intentionally configured.

## K005 - Meta Graph API v26.0 expiration date is TBD

Resolved portion: the repository intentionally pins `META_GRAPH_API_VERSION=v26.0`, based on the Meta version table supplied for this project on 2026-09-21.

Remaining concern: Meta currently lists the v26.0 expiration date as TBD.

Before production rollout, or when Meta publishes an expiration date, re-check the official Meta version table and update code/docs only if needed.

## K006 - Automated quality workflow is active

The GitHub Actions CI workflow has been observed completing successfully after the runtime-diagnostics changes.

The quality gate includes:

- TypeScript typecheck
- ESLint
- Vitest
- Next.js production build

This does not make future commits automatically trusted. The CI result for each relevant commit must still be checked before claiming success.

## K007 - Webhook acknowledgement behavior

The current implementation processes media before returning the POST response.

For low-volume prototype testing this may be acceptable, but for production reliability Meta retry/timeout behavior should be reviewed. A future architecture may need fast acknowledgement plus durable background processing.

Do not change this architecture without user approval because it introduces queue/runtime choices.

## K008 - Media limits

The prototype maximum media size is configured as 15 MiB:

`15728640`

This is a project safety choice, not a claimed Meta platform limit.

## K009 - OCR and inventory semantics remain partially open

Structured PDF fields and a human approval state are now defined for selectable-text documents.

Still undefined:

- what constitutes warehouse stock IN vs stock OUT
- opening-balance source
- return/cancellation/reversal behavior
- whether and when approved document data is allowed to mutate inventory

Image-only/scanned PDFs also still require a future OCR decision.

## K010 - GitHub Pages is configured in code but not enabled in repository settings

The Quality Pages workflow was executed and all code-quality steps passed, including report generation.

The workflow then failed specifically at `actions/configure-pages` because GitHub Pages is not yet enabled/configured for this repository.

Required manual repository setting:

`Settings -> Pages -> Build and deployment -> Source -> GitHub Actions`

The repository is private. Private-repository Pages availability depends on the GitHub account/plan.

If Pages is unavailable, CI remains the authoritative test system. Do not make this repository public merely to obtain a Pages status page without explicit user approval.

## K011 - Credentialed provider harness passes

Resolved on 2026-09-21.

Workflow run `35578308664` completed successfully after assigning the system user to the Test WhatsApp Business Account with Messages and Phone numbers (view only) access.

All credentialed checks passed, including:

- security filters
- text persistence
- idempotency
- private bucket verification
- Meta synthetic PDF upload
- Meta media metadata retrieval and download
- deployed document ingestion into private Supabase Storage
- stored-file SHA-256 integrity
- cleanup of Meta media and Supabase fixtures

The harness creates signed synthetic webhook payloads itself, but real Meta-delivered inbound text and PDF callbacks have now also been verified separately.

## K012 - Dependency installs are reproducible

Resolved: `package-lock.json` is committed and CI/Pages workflows use `npm ci`.

Any future dependency change must update both `package.json` and `package-lock.json`.

## K013 - Security filters restored after Meta dashboard sample testing

Resolved on 2026-09-21.

The user restored both:

- `ALLOWED_WHATSAPP_SENDERS`
- `WHATSAPP_PHONE_NUMBER_ID`

The deployed health endpoint was verified afterward and reports both fields present with webhook and ingestion validation healthy.

The credentialed integration harness is designed to keep both protections enabled.


## K014 - GitHub integration secrets configured

Resolved on 2026-09-21.

The user configured the required `integration` environment secrets and the manual workflow can access them.

Secret values remain intentionally unreadable from repository code and reports. Do not copy credentials into workflow inputs, source files, issues, or chat.


## K015 - Real inbound callback verified after publishing and WABA subscription

Resolved on 2026-09-21.

After publishing the Meta app and subscribing the app to the Test WhatsApp Business Account, real inbound webhook delivery began working.

A real text and a real PDF/document were both delivered to the deployed custom webhook and stored successfully.


## K016 - Meta privacy-policy publishing requirement completed

Resolved on 2026-09-21.

The public policy is live at:

`https://solar-ops-whatsapp.vercel.app/privacy`

The URL was entered into Meta App Settings and the app was published successfully.


## K017 - Structured document draft schema is defined; stock authority is not

Resolved portion: selectable-text PDFs now produce bounded extracted text plus structured review fields for document identity, parties, e-Way metadata, dispatch data, totals, and product line items.

Remaining boundary: an approved parser draft is not automatically authoritative for warehouse stock. Stock mutation stays disabled until the business rules in K022 are explicitly defined.

## K018 - Media retention timing is approximate

The cleanup cutoff is 24 hours, but the scheduled GitHub Actions job runs once per day and may be delayed by GitHub.

Therefore a raw file can remain longer than 24 hours before the next cleanup run.

This is acceptable for the current low-cost prototype. If a strict deletion SLA is required later, move the cleanup to a scheduler with stronger timing guarantees.


## K019 - Dashboard bootstrap authentication should be replaced before broader production use

The internal dashboard supports a dedicated `OPS_ACCESS_KEY`, but the current deployment can fall back to `WHATSAPP_VERIFY_TOKEN` so the prototype works without a new environment variable.

This is acceptable for the current single-operator verification prototype, but broader production or mobile use should move to dedicated user authentication (for example Supabase Auth) and remove the fallback.

## K020 - Human-visible signed preview needs one interactive verification

The private bucket, stored document row, and Storage object are live-verified.

The signed-preview implementation follows Supabase's current private-bucket signed URL API and is covered by the production build, but a human opening the file through the authenticated `/ops` dashboard remains the final UI-level preview check.


## K021 - OCR fallback is intentionally not implemented yet

Selectable-text PDFs are parsed locally. Scanned/image-only PDFs are marked `needs_ocr`.

No paid OCR provider or heavy local OCR runtime has been added without a validated need.

## K022 - Outgoing inventory semantics defined

Resolved for the current outgoing/dispatch document.

The user selected one-time manual Opening Stock and confirmed that the currently handled bill reduces existing stock after document approval.

The implementation is intentionally fail-closed: company/product alias, unit, quantity, balance, idempotency, correction, and reversal rules are enforced by the stock ledger.

Automatic Stock IN remains undefined until a real receiving document is provided.

## K023 - Manual reply scope is limited to the open service window

The UI supports free-form operator replies only when the latest inbound message from that WhatsApp user is within 24 hours.

Approved Meta template messaging outside that window is not implemented.

## K024 - Vercel production deployment recovered after quota delay

Resolved on 2026-09-23.

A fresh validated `main` merge triggered production deployment `dpl_9WE9Jx8e7owEUuS4gRc9QZzckmtd`. The stable alias moved to commit `227f171bbe705e55f3f0822ec6b9d8a76ad11176`, reached `READY`, and `/api/health` plus the protected `/ops` login surface returned HTTP 200.

Future source changes still require the normal CI -> main -> production READY -> route verification sequence.


## K025 - Nested branch names bypassed the original preview-deployment pattern

Observed on 2026-09-23: a `chore/...` branch still created a Vercel Preview even though the repository used `"*": false`.

The repository now uses the recursive branch rule `"**": false` with `"main": true`, so slash-delimited branches such as `feature/...`, `fix/...`, and `chore/...` are included in the disabled set.

This source configuration must still be judged by observed future Vercel behavior; do not assume provider behavior solely from the file.


## K026 - Operations chat viewport, manual refresh, and reply failure reporting

Observed on 2026-09-25 from the production UI:

- global `article` styling leaked into chat rows and produced large card-like message blocks
- the operations shell could exceed the viewport, hiding the composer below the page fold
- conversations opened at older content rather than the newest message
- new data required a manual full-page Refresh interaction
- a failed Meta send returned HTTP 400
- repeated submission of the same failed request could incorrectly redirect with `reply=sent`

The current source change isolates message-row styling, uses a viewport-locked WhatsApp-Web-like layout, auto-scrolls newly opened conversations, adds visible-tab automatic refresh, guards duplicate submits, maps duplicate failed/queued states accurately, and retains bounded redacted Meta send diagnostics.

The exact Meta HTTP 400 cause from the already-failed historical request cannot be recovered because the previous production code discarded Meta's response body. A new explicit operator-triggered reply test after deployment is required to capture any future provider rejection safely.

## K027 - Groq document automation requires production configuration and live acceptance

The source supports optional fail-closed Groq verification and interactive document summaries, but this provider path must not be called production-verified until all of the following are observed:

- production database migration applied
- Groq Zero Data Retention enabled
- `GROQ_API_KEY` configured server-side
- `DOCUMENT_AUTOMATION_ENABLED=true`
- production Vercel deployment is READY on the expected main commit
- a non-sensitive selectable-text PDF completes parser + Groq agreement
- automatic WhatsApp summary with Edit/Delete is received
- correction and cancellation paths are exercised

Until those steps are completed, the feature must remain disabled.

## K028 - Strict schema does not guarantee semantic AI accuracy

Groq strict structured output guarantees the returned JSON matches the requested schema; it does not guarantee that extracted business facts are correct.

Solar Ops therefore never auto-records based on Groq alone. The deterministic parser and Groq must independently agree across the entire persisted draft, and arithmetic checks must pass. Any disagreement becomes `review_required`.

## K029 - Edit menu intentionally covers a bounded operational subset

The WhatsApp Edit menu currently exposes document number, vehicle number, and up to eight line-item quantities. This keeps the interaction within WhatsApp list limits and focuses on the highest-value operational corrections.

Other structured fields remain reviewable in `/ops`. Expand editable fields only when the operator workflow requires them; do not silently accept arbitrary free-form field names.

## K030 - Automatic Stock IN remains intentionally unavailable

Outgoing Stock OUT is now explicitly approved using one-time Opening Stock.

Receiving/Stock IN is still not implemented. The user plans to provide a separate stock-IN PDF; that document must be inspected before defining its company/product mapping, receiving timestamp, returns, or other inbound rules.


## K031 - Product/company aliases require operator confirmation

Normalization and fuzzy similarity are not enough to prove identity.

A new bill spelling that does not match an existing canonical/approved alias blocks Stock OUT and is surfaced in WhatsApp for explicit selection. This can create occasional first-use prompts, but avoids silent inventory corruption.

## K032 - Opening Stock is intentionally one-time

The Stock setup refuses to silently overwrite an existing product's Opening Stock.

A future requirement for correcting a mistaken opening balance should be implemented as a separately audited adjustment movement rather than editing the historical opening row.

## K033 - Stock workflow still requires production live acceptance

Database functions and CI tests do not prove Meta interactive stock mapping works end-to-end.

Before declaring the feature live-verified, production must demonstrate with non-sensitive test data:

- Opening Stock visible in `/ops/stock`
- approved/verified bill deducts once
- duplicate retry does not deduct twice
- a spelling mismatch produces a WhatsApp product/company selection
- selecting it saves an alias and retries the bill
- insufficient stock deducts zero
- quantity correction adjusts the ledger
- Delete restores stock before cancellation


## K034 - Opening Stock GSTIN clipboard normalization

A production test exposed that a visually valid 15-character GSTIN could still be rejected when the browser submitted additional clipboard text or characters.

Resolution in source:

- NFKC normalization is applied
- a single standard GSTIN-shaped token may be extracted from surrounding copied label text
- punctuation/invisible characters do not cause a valid standalone GSTIN to be truncated before validation
- multiple GSTIN candidates are rejected instead of guessed
- temporary GSTIN diagnostic metadata logging used during investigation has been removed from the production route

The operator later confirmed the original short GSTIN submission was user input error. Robust GSTIN normalization remains, but the temporary debugging metadata is no longer part of the live code path.


## K035 - Stock screen was previously full-navigation on mutation

The initial `/ops/stock` implementation used a normal HTML POST followed by a 303 redirect, which made every save feel like a full page refresh.

Resolution in source: normal stock add/adjust interactions now use a client `StockManager` with fetch plus Next.js `router.refresh()`. The app remains a hybrid App Router application rather than a pure client SPA.

Production-live acceptance is still required after deployment to confirm the operator sees the intended no-document-reload behavior.

## K036 - Current stock adjustment is an audited physical correction

The Current stock table now supports setting a target physical quantity.

This does not edit the historical Opening Stock value. The system appends an `adjustment` delta instead. This distinction is intentional and should remain visible in future audit/reporting work.


## K037 - Stock page visual design was desktop-biased and generic

Observed after the initial stock-management release:

- the dark presentation felt visually generic and inconsistent with a form-heavy inventory workflow
- the responsive table/card treatment was not comfortable on narrow mobile screens
- the long add-product form appeared before the more frequent current-stock task on mobile

Resolution in source:

- mobile-first Current stock ordering
- responsive inventory rows instead of mobile table conversion
- scoped light design-token system
- larger touch targets and cleaner form hierarchy
- desktop-only section reordering for efficient use of width
- no new UI/design dependency

Production-live visual acceptance remains required after deployment.


## K038 - Long Add opening stock form consumed mobile page space

After the mobile-first light redesign, the full Opening Stock form was still permanently present below inventory on narrow screens.

Resolution in source:

- mobile floating **+ Add stock** trigger
- Opening Stock form presented as a bottom sheet
- backdrop/close/Escape dismissal
- body-scroll lock while open
- safe-area-aware spacing and sticky Save action
- desktop inline form preserved
- no additional UI library

Production-live mobile acceptance remains required after deployment.


## K039 - Opening Stock previously allowed GSTIN-less companies

The initial Opening Stock form treated GSTIN as optional, which allowed company identity to rely too heavily on name spelling.

Resolution in source/database:

- new stock companies require GSTIN
- existing selected companies reuse their saved GSTIN
- conflicting GSTIN is rejected
- `stock_companies.gstin` is now `NOT NULL`
- current production stock companies were checked before the constraint and none had missing GSTIN

Production-live form acceptance remains required after deployment.


## K040 - Mobile Dispatch has no independent dispatch/driver data model

The current backend does not yet store driver assignment, trip lifecycle, delivered-at timestamps, or external-vehicle records as a dedicated dispatch model.

The native API therefore exposes only dispatch-related fields already parsed from real bills (vehicle number, destination, consignee and workflow/stock status). The mobile UI must show a truthful empty/unavailable state when those fields do not exist and must not fabricate delivery progress.


## K041 - Repeated business-document uploads need cross-draft stock idempotency

Observed on 2026-09-25 while testing the same delivery-note/e-Way Bill more than once.

WhatsApp message-id idempotency prevents a retried webhook from duplicating one message, but a user can legitimately send the same PDF again and create a new message and draft. Draft/item-scoped stock ledger keys alone therefore do not protect against a second Stock OUT for the same business document.

The pending cross-draft guard claims a normalized document identity atomically inside the Stock OUT transaction. It prefers e-Way Bill number; when that is absent it uses supplier GSTIN plus document number. A later draft with an already-claimed identity returns `duplicate_document` and must create zero additional Stock OUT rows. The claim remains after reversal so a cancelled/reversed document cannot silently become stock-active again through a re-upload; any such case requires explicit operator review.

This change requires migration application plus automated CI and database-level verification before production acceptance.

## K037 - Fast WhatsApp query source needs production-live acceptance

Source now contains a deterministic read-only fast path for a small set of operational WhatsApp questions.

What is implemented in source:

- today's PDF-bill count
- pending/review-required bill count
- latest bill summary
- exact canonical/operator-approved-alias stock balance
- no Groq call for these supported intents
- correction-session priority and outbound reply idempotency are preserved

What is not yet proven live:

- real WhatsApp phrasing through the production deployment
- observed end-to-end response latency
- production response behavior for exact stock aliases

Voice transcription and a Groq fallback for unsupported natural-language phrasing are not implemented by this change. They must not be described as available until separately designed, tested, and verified.

## K038 - AI query fallback still needs provider-live phrasing evidence

Source now includes a token-bounded Groq intent fallback for unresolved operational text.

The fallback does not send PDFs, extracted bill text, database rows, ledger history, or chat history to Groq and it does not generate source-of-truth business values.

Still requiring live evidence after deployment:

- one real Malayalam/Manglish operational question that misses deterministic routing but maps correctly through Groq
- observed end-to-end latency for that fallback
- confirmation that unsupported conversational text does not trigger an incorrect business answer

Voice transcription remains outside this change.

## K039 - Near-duplicate stock products remain separate identities

Production data currently contains at least one pair of very similar canonical stock names that are separate product IDs and have separate balances.

The typo-tolerant read-only search must therefore return both when a query cannot distinguish them. It must not merge, delete, or aggregate those identities automatically. Any catalogue cleanup requires an explicit stock-history reconciliation decision.

## K040 - Existing duplicate product history requires manual reconciliation

The deterministic identity fix prevents new hard-equivalent products from being created, but it intentionally does not rewrite existing ledger history.

The current `Emmvee 560 Wp Topcon Dcr Panel` / `Panels` pair therefore remains two historical product IDs until the opening quantities and ledger history are explicitly reconciled. Automatic summing, deleting, or reassigning these balances is unsafe without confirming which opening quantity represents the intended physical stock.

## K041 - Negative stock means incomplete stock input, not failed outgoing history

With ledger-first inventory, current quantity may be negative when outgoing bills have been recorded before opening/incoming stock is entered. The mobile UI labels this as a pending stock entry rather than hiding the outgoing event.

This is intentional. Operators must add Stock IN/opening data or use an audited physical adjustment when the real quantity becomes known.




### 2026-10-03 follow-up
The missing company alias source and cross-draft stock guard are repaired by the mobile simplification migration. Historical duplicate rows remain for audit and are classified without ledger replay. The compact home API displays canonical bills and truthful stock/trip attention states. Existing unposted canonical bills must be explicitly checked again; this release does not bulk replay historical stock. Original files still expire after approximately 24 hours, including pending reviews. OCR support is unchanged. Mobile authentication remains a shared operator session; company switching is not separate tenant authorization. APK signing still follows the existing development signing configuration.


## 2026-10-04 — Voice recognition remains provider-dependent
The reported Malayalam stock question lost its brand/model during transcription. Source now supplies Malayalam language/context and uses a heard-text clarification for unresolved voice. Updated transcription accuracy on the actual audio is not live-verified. Current inspected production data had no active stock product rows or ledger movements; absence of a stock record must never be presented as physical quantity zero.
