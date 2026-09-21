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

A real Meta-delivered inbound PDF remains a separate acceptance test.

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

## K009 - No OCR or inventory semantics

There is no defined rule yet for:

- which invoice fields matter
- how company identity is determined
- what constitutes stock in/out
- how corrections work
- who approves extracted data

These decisions must be defined with the user before adding OCR/inventory automation.

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

Remaining limitation: the harness creates signed synthetic webhook payloads itself, so real Meta-delivered inbound WhatsApp callbacks are still a separate acceptance test.

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


## K017 - Structured invoice extraction fields are not defined yet

The user approved the direction of keeping only useful data and deleting raw media after short retention.

The system intentionally does not yet decide which invoice fields are authoritative.

Before implementing OCR/parser output as operational data, define at least:

- company identity rule
- invoice/bill identifier
- date semantics
- product/description fields
- quantity/unit semantics
- correction/approval behavior
- whether any extracted field is allowed to affect stock

Do not infer these rules from a single sample bill.

## K018 - Media retention timing is approximate

The cleanup cutoff is 24 hours, but the scheduled GitHub Actions job runs once per day and may be delayed by GitHub.

Therefore a raw file can remain longer than 24 hours before the next cleanup run.

This is acceptable for the current low-cost prototype. If a strict deletion SLA is required later, move the cleanup to a scheduler with stronger timing guarantees.
