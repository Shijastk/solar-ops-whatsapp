# Known Issues and Open Concerns

## K001 - Custom Meta -> Vercel -> Supabase path partially proven

Verified on 2026-09-21:

- Meta custom webhook GET verification succeeds.
- Meta dashboard `messages` POST reaches Vercel.
- A dashboard sample text is parsed and stored successfully in `public.whatsapp_messages`.
- The user visually confirmed the Supabase row exists.

Not yet proven:

- a real inbound WhatsApp text reaches the custom webhook while the Meta app is unpublished
- live media download from Meta
- private Storage upload
- complete real PDF path

Do not call Milestone 1 complete yet.

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

## K003 - Supabase database write is verified; media storage is not

Verified:

- `supabase/schema.sql` was applied by the user
- `public.whatsapp_messages` exists
- private `whatsapp-media` bucket was created by the user
- Meta dashboard sample text was written to the table

Still unverified:

- live Meta media retrieval
- actual file upload into `whatsapp-media`
- media `storage_path` update

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

## K011 - Real provider integrations are not fully covered yet

The initial automated test suite intentionally avoids real Meta and Supabase credentials.

The dashboard sample proves text persistence, but live Meta media download, Supabase Storage, database idempotency under retries, and a complete real Meta -> Vercel -> Supabase media delivery still require the documented end-to-end test.

## K012 - Dependency installs are reproducible

Resolved: `package-lock.json` is committed and CI/Pages workflows use `npm ci`.

Any future dependency change must update both `package.json` and `package-lock.json`.

## K013 - Security filters temporarily disabled for Meta dashboard sample testing

For the dashboard-only sample text test, the user temporarily removed:

- `ALLOWED_WHATSAPP_SENDERS`
- `WHATSAPP_PHONE_NUMBER_ID`

This was necessary because Meta's dashboard sample values do not match the project's real test sender/destination values.

Before any broader live testing or production use, restore both values and redeploy.
