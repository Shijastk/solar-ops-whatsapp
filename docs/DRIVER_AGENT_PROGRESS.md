# Driver Agent — Persistent Execution Log

Last updated: 2026-10-18

## Current objective

Finish driver operations as a reliable, tested capability before treating the wider Solar Ops agent as complete. Work incrementally; every claim must link to a commit and CI result. This log is intentionally stored in `docs/` so a future conversation can resume without reconstructing progress from chat.

## Verified baseline

- `lib/driver-agent.ts` currently recognizes a narrow set of explicit create/deactivate commands.
- Driver creation has normalized-name duplicate protection and a read-after-write check.
- Deactivation deliberately fails closed because a durable sender-scoped confirmation flow is not yet implemented.
- The driver handler is gated by `SOLAR_OPS_DRIVER_AGENT_ENABLED`; production flag must remain unchanged during development.
- `lib/ingest.ts` calls the driver handler before the document workflow for text messages.
- The driver table is queried as `ops_drivers` with `id`, `name`, `normalized_name`, and `active`; the inspected `supabase/schema.sql` and listed migrations did not expose its creation source, so the authoritative source still needs to be located before schema-dependent write/confirmation design.
- The existing WhatsApp integration test can target production by default and must not be run blindly.

## Work in this branch

- Added explicit English/Manglish read-only driver-list intent parsing.
- Added a bounded query (maximum 50 rows), sorted by name, and response containing active drivers only.
- Added parser regression coverage for `List drivers`, `Show all drivers`, and `driver list kaanikku`.
- The existing `named` incomplete-command guard from the regression branch is included in this branch.

## Required verification

- GitHub Actions must pass typecheck, lint, unit tests, and production build for the current branch.
- Review any CI failure and fix it before moving on.
- This code branch is not merged and must not be considered deployed or live-verified.

## Remaining driver completion criteria

- Locate and document the authoritative `ops_drivers` schema/migration and any authorization constraints.
- Add isolated handler tests with mocked Supabase and WhatsApp reply transport for list/create/duplicate/invalid/database-error paths.
- Support read-by-name and update only after the actual schema and desired editable fields are established.
- Implement durable, sender-scoped, expiring, one-time confirmation for deactivation; ensure retries are idempotent and wrong senders cannot confirm.
- Expand Malayalam/Manglish coverage from real examples; ambiguous or incomplete commands must not mutate.
- Verify persistence using an isolated test database or test deployment; never use production driver records as fixtures.
- Only mark driver capability complete after all relevant CI and isolated integration checks pass. Do not enable the production feature flag or merge without explicit authorization.

## Evidence log

| Date | Change | Commit | Result |
|---|---|---|---|
| 2026-10-18 | Added driver listing parser and handler | `ee5e63647f13ef01f3fe777c5779453dd80552d3` | Implemented; superseded by type-safety fix below; CI pending |
| 2026-10-18 | Avoid accessing `intent.name` for list intents | `3cdb6bc4c9be4ee6c05ed3c53533280aa4276bd3` | Fix committed; CI pending |
| 2026-10-18 | Added list-intent parser tests | `0f802d3449a9fe7aca264c394a46e9db542f0da5` | Tests committed; superseded by final branch head |
| 2026-10-18 | Narrowed Malayalam/Manglish parser action type after adding `list` | `ed50364381571a407234db7a464dcf10e827a290`; CI run `39126913313` | CI queued at last check; do not claim PASS until result is inspected |
