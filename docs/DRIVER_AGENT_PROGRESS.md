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
- The checked-in `supabase/schema.sql` and listed migrations do not expose the `ops_drivers` creation source. A read-only Supabase `information_schema.columns` query verified live fields: `id uuid`, `name text`, `normalized_name text`, `active boolean`, nullable `last_used_at timestamptz`, and `created_at`/`updated_at` timestamps. The missing checked-in migration remains a reproducibility gap.
- The existing WhatsApp integration test can target production by default and must not be run blindly.

## Work in this branch

- Added explicit English/Manglish read-only driver-list intent parsing.
- Added a bounded query (maximum 50 rows), sorted by name, and response containing active drivers only.
- Added parser regression coverage for `List drivers`, `Show all drivers`, and `driver list kaanikku`.
- The existing `named` incomplete-command guard from the regression branch is included in this branch.

## Required verification

- GitHub Actions run `39126913313` passed on code commit `ed50364381571a407234db7a464dcf10e827a290`: dependency install, TypeScript typecheck, lint, unit tests, and production build all succeeded.
- The final branch head later changed only the progress document; runtime code is unchanged from the tested code commit. The branch is still unmerged and not live-verified.
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
| 2026-10-18 | Narrowed Malayalam/Manglish parser action type after adding `list` | `ed50364381571a407234db7a464dcf10e827a290`; CI run `39126913313` | PASS: typecheck, lint, unit tests, production build |
| 2026-10-18 | Read-only inspection of live `ops_drivers` columns and public table list | Supabase `information_schema` queries (read-only) | PASS: schema metadata verified; no business rows read or modified |


## Follow-up test expansion — 2026-10-18

- Added parser tests on `test/driver-agent-handler-isolation` commit `315238234f90f3810925a01b4eb9179086649bdc` for placeholder names, one-character names, names longer than 120 characters, and ambiguous Malayalam/Manglish mentions.
- This is test-only; it does not change runtime code, production data, or the production feature gate.
- CI for the latest head commit is **not yet confirmed**. The commit workflow/status queries returned no associated runs/statuses at inspection time; do not treat the previous successful run as evidence for this latest test change.
- PR #60 remains open and draft, head SHA `315238234f90f3810925a01b4eb9179086649bdc`; PR #57, #58, and #59 were also observed open, unmerged, and draft. No PR was merged.
- Next: wait for/inspect CI for the exact latest head; if it fails, diagnose and fix before proceeding to mocked create-handler coverage. Continue to avoid production mutations and leave deactivation fail-closed.

## Verification follow-up — 2026-10-18

- Added isolated create-handler tests in commit `265eee22c4a3f7ef87f6178b37e282c3452d01b7` for verification-query failure and concurrent unique-key insert conflict. The tests mock Supabase and reply transport; they do not access production rows or send WhatsApp messages.
- Latest known PR #60 head is being rechecked after this commit. The repository CI workflow `.github/workflows/ci.yml` runs on pushes and on pull requests targeting `main`; PR #60 currently targets `agent/driver-automation-continuation`, so its pull-request event does not match that branch filter.
- The available commit-workflow query only returns pull-request-triggered runs and does not expose push-triggered runs; combined commit status returned no status entries for the prior head. Therefore CI for the latest commit cannot be claimed as passing from the currently available evidence.
- Do not treat earlier successful run `39126913313` as verification for the newer tests. Do not merge or enable the production feature gate. Driver completion is still blocked on exact-head CI evidence, isolated persistence verification, authoritative schema provenance, and a durable sender-scoped expiring one-time deactivation confirmation flow.
