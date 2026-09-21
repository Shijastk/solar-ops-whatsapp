# Known Issues and Open Concerns

## K001 - Custom deployment not yet tested end-to-end

The repository has initial implementation, but the deployed custom Vercel webhook has not yet been connected to Meta and proven against Supabase.

Do not call Milestone 1 complete.

## K002 - Vercel deployment is not yet established for this repository

The GitHub repository exists, but this repository was not found as an existing Vercel project during the initial connector inspection.

A deployment/import still needs to be established.

## K003 - Supabase runtime configuration not yet verified

The repository expects a Supabase project, SQL schema, private bucket, and environment secrets.

The code must not be described as operational until these are configured and tested.

## K004 - Meta access token lifecycle

The current Meta test setup may use a temporary token.

Before long-lived operation, token lifecycle and the appropriate production credential setup must be intentionally configured.

## K005 - Meta Graph API v26.0 expiration date is TBD

Resolved portion: the repository now intentionally pins `META_GRAPH_API_VERSION=v26.0`, based on the Meta version table supplied for this project on 2026-09-21.

Remaining concern: Meta currently lists the v26.0 expiration date as TBD.

Before production rollout, or when Meta publishes an expiration date, re-check the official Meta version table and update code/docs only if needed.

## K006 - Automated quality workflow must still be observed

Automated tests and CI are being added to the repository.

Do not claim they pass until a real GitHub Actions run for the resulting commit completes successfully.

## K007 - Webhook acknowledgement behavior

The current implementation processes media before returning the POST response.

For low-volume prototype testing this may be acceptable, but for production reliability Meta retry/timeout behavior should be reviewed. A future architecture may need fast acknowledgement plus durable background processing.

Do not change this architecture without user approval because it introduces queue/runtime choices.

## K008 - Media limits

The current default maximum media size is 15 MiB.

This is a project safety choice, not a claimed Meta platform limit.

Change it only intentionally.

## K009 - No OCR or inventory semantics

There is no defined rule yet for:

- which invoice fields matter
- how company identity is determined
- what constitutes stock in/out
- how corrections work
- who approves extracted data

These decisions must be defined with the user before adding OCR/inventory automation.

## K010 - GitHub Pages availability and visibility

The repository is private.

GitHub Pages for private repositories depends on the GitHub plan. GitHub's current documentation says private-repository Pages requires GitHub Pro, Team, Enterprise Cloud, or Enterprise Server.

Also, a Pages site can be publicly reachable even when the source repository is private. Therefore the generated quality page is intentionally restricted to non-sensitive build metadata only.

If Pages is unavailable on the account, CI remains the authoritative test system and the project must not be made public merely to obtain a status page without explicit user approval.

## K011 - Real provider integrations are not covered by unit tests yet

The initial automated test suite intentionally avoids real Meta and Supabase credentials.

Live Meta media download, Supabase Storage, database idempotency, and Vercel runtime behavior still require the documented end-to-end test.
