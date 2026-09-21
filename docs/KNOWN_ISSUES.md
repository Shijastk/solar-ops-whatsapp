# Known Issues and Open Concerns

## K001 - Custom Meta -> Vercel -> Supabase path not yet complete

The Meta custom webhook is now verified and Meta's dashboard test reaches the deployed Vercel POST endpoint.

Current blocker:

- `MAX_MEDIA_BYTES` is empty/missing in Vercel.
- Full runtime validation therefore reports ingestion configuration invalid.
- Meta's `messages` dashboard test currently receives HTTP 503 from the webhook.

Do not call Milestone 1 complete until this value is corrected and the live Supabase write/media path is proven.

## K002 - Vercel deployment is established

Resolved on 2026-09-21.

Verified:

- Vercel project `solar-ops-whatsapp` exists
- framework is Next.js
- production deployment state is `READY`
- stable alias is `https://solar-ops-whatsapp.vercel.app`
- Meta webhook GET verification reached the deployed route and returned HTTP 200
- Meta dashboard POST test reached the deployed route
- no platform/runtime routing failure is blocking access to the endpoint

The current HTTP 503 is application configuration validation, not a Vercel routing failure.

## K003 - Supabase credentials are present, but live writes are not yet verified

The deployed runtime reports Supabase configuration fields as present.

That does not yet prove:

- `supabase/schema.sql` was applied exactly as expected
- the `whatsapp-media` bucket is private and correctly named
- the webhook can write rows
- the webhook can upload media

Those will be verified after the current environment validation blocker is fixed.

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

The intended prototype default maximum media size is 15 MiB.

The current Vercel environment contains an empty/missing `MAX_MEDIA_BYTES` value, which is the active configuration blocker.

Set it to:

`15728640`

This value is a project safety choice, not a claimed Meta platform limit.

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

## K011 - Real provider integrations are not covered by unit tests yet

The initial automated test suite intentionally avoids real Meta and Supabase credentials.

Live Meta media download, Supabase Storage, database idempotency, and complete Meta -> Vercel -> Supabase delivery still require the documented end-to-end test.

## K012 - Dependency installs are reproducible

Resolved: `package-lock.json` is committed and CI/Pages workflows use `npm ci`.

Any future dependency change must update both `package.json` and `package-lock.json`.
