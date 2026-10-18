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
- At the time of this entry, the connector's commit-workflow query did not expose the push-triggered run. Later, the direct GitHub Actions run metadata and job logs verified the exact current test head; see the CI verification entry below.
- PR #60 remains open and draft, head SHA `315238234f90f3810925a01b4eb9179086649bdc`; PR #57, #58, and #59 were also observed open, unmerged, and draft. No PR was merged.
- Next: wait for/inspect CI for the exact latest head; if it fails, diagnose and fix before proceeding to mocked create-handler coverage. Continue to avoid production mutations and leave deactivation fail-closed.

## Verification follow-up — 2026-10-18

- Added isolated create-handler tests in commit `265eee22c4a3f7ef87f6178b37e282c3452d01b7` for verification-query failure and concurrent unique-key insert conflict. The tests mock Supabase and reply transport; they do not access production rows or send WhatsApp messages.
- Latest known PR #60 head is being rechecked after this commit. The repository CI workflow `.github/workflows/ci.yml` runs on pushes and on pull requests targeting `main`; PR #60 currently targets `agent/driver-automation-continuation`, so its pull-request event does not match that branch filter.
- The connector's convenience workflow query filters to pull-request-triggered runs. Direct GitHub Actions REST metadata was subsequently used to inspect push-triggered runs and job logs; see the exact-head CI result below.
- Do not treat earlier successful run `39126913313` as verification for the newer tests. Do not merge or enable the production feature gate. Driver completion is still blocked on exact-head CI evidence, isolated persistence verification, authoritative schema provenance, and a durable sender-scoped expiring one-time deactivation confirmation flow.

- CI trigger correction committed on the PR base branch: `agent/driver-automation-continuation` now appears in `.github/workflows/ci.yml`'s `pull_request.branches` filter (base-branch commit `3db620fb8c52d117a66c8eb6401d69dbd2a53cfc`). Direct GitHub Actions API evidence confirms push-triggered CI runs on the test branch.


## Exact-head CI result — 2026-10-18

- Commit `1b99ca6b8f6c9b8ec16a9bd1262a3773d3ac431b` fixed the invalid TypeScript declarations in `tests/driver-agent-create.test.ts`.
- GitHub Actions run [39130929497](https://github.com/Shijastk/solar-ops-whatsapp/actions/runs/39130929497) completed with **success** on exact head SHA `1b99ca6b8f6c9b8ec16a9bd1262a3773d3ac431b`.
- All required steps passed: dependency install, TypeScript typecheck, lint, unit tests, and production build.
- This result applies to that exact SHA only. The next commit will require its own CI verification. PR #60 remains draft/unmerged; no production data or WhatsApp messages were changed; production feature flag remains disabled.

## Sender-scoped deactivation confirmation implementation — 2026-10-18

- Added reproducible bootstrap migration `supabase/migrations/20261018115900_ops_drivers_catalog.sql` for fresh environments. The existing live catalog was previously present in database metadata but had no matching repository migration.
- Added `supabase/migrations/20261018120000_ops_driver_deactivation_confirmation.sql`: confirmation records store only SHA-256 token hashes, bind the request to the originating WhatsApp sender and driver, expire after the requested five-minute window, and can be consumed once.
- Added atomic `confirm_ops_driver_deactivation(text,text)` database function. It locks the confirmation row, checks sender/action/expiry/consumption, deactivates only the referenced active driver, and consumes the token in the same transaction. Function execution is granted only to `service_role`; table access is revoked from `public`, `anon`, and `authenticated`.
- Updated `lib/driver-agent.ts` to issue a cryptographically random 192-bit one-time token for a uniquely matched active driver and accept only the explicit `CONFIRM DRIVER <token>` form. Confirmation tokens are hashed before storage and never stored in plaintext. Invalid, expired, reused, or wrong-sender tokens cannot deactivate a driver.
- Expanded isolated handler tests for confirmation creation, hashed-token storage, sender binding, database insert failures, atomic RPC success/error, and invalid/expired token responses. Tests mock Supabase and WhatsApp reply transport.
- **Not yet production-ready:** both migrations were applied and behavior-tested in a disposable PostgreSQL 16 database by GitHub Actions run [39131835785](https://github.com/Shijastk/solar-ops-whatsapp/actions/runs/39131835785), including correct sender, wrong sender, expiry, and replay cases. They have not been applied to any Supabase environment. No production rows or WhatsApp messages were changed. Before rollout, confirm the live catalog compatibility and apply through the reviewed migration process. Production feature flag remains disabled and PR #60 remains draft/unmerged.

## Latest confirmation-flow CI evidence — 2026-10-18

- Commit `452531b18006f726e33d937206d17167bacd4638` corrected the confirmation-token parser and reply newline.
- GitHub Actions run [39131693789](https://github.com/Shijastk/solar-ops-whatsapp/actions/runs/39131693789) completed successfully on that exact SHA. Dependency install, TypeScript typecheck, lint, all unit tests, and production build passed.
- SQL migrations have passed an isolated PostgreSQL 16 integration job in run [39131835785](https://github.com/Shijastk/solar-ops-whatsapp/actions/runs/39131835785); they remain unapplied to Supabase. Do not merge or enable the production flag until the live catalog has been checked for compatibility and the migration is reviewed.
