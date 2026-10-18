# Safe testing runbook — PR #56

## Current status

- This branch is experimental and must remain a Draft PR until reviewed.
- `SOLAR_OPS_DRIVER_AGENT_ENABLED` defaults to `false`; do not enable it in production.
- The driver handler currently supports explicit driver creation. Deactivation requests are deliberately fail-closed: the handler replies that confirmation is not implemented and does not update the row.
- The current CI run proves typecheck, lint, unit tests, and production build passed for the tested commit. It does not prove live WhatsApp delivery, database mutation behavior, or production readiness.

## Gate 1 — isolated code checks

On the branch, run:

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

Confirm the CI workflow reports success for the latest branch SHA. Do not use production credentials in a local test environment.

## Gate 2 — database safety

Use a separate Supabase test project, not the production project. Apply the same schema/migrations and verify:

1. `ops_drivers.normalized_name` has a unique constraint.
2. A create request inserts one active row and a follow-up duplicate request does not insert another.
3. Concurrent create requests for the same normalized name leave one row only.
4. An existing inactive row is not silently reactivated.
5. Database lookup/insert failures do not produce a success reply.
6. A deactivate/delete request does not change `active` until a durable, sender-scoped confirmation flow is implemented and tested.
7. Verify the row after each write; clean up only test records created for this run.

Do not run destructive cleanup queries against production.

## Gate 3 — webhook integration in a test environment

Only after Gate 1 and Gate 2 pass:

1. Use a separate Meta test phone number / test recipient and the test Supabase project.
2. Keep the sender allowlist restricted to the tester's number.
3. Enable `SOLAR_OPS_DRIVER_AGENT_ENABLED=true` only in the isolated test deployment.
4. Send a unique test message such as `Add new driver named QA Driver 20261018`.
5. Verify the reply and exactly one matching row in the test database.
6. Repeat the same command and verify no second row is created.
7. Send a normal mention such as `What do you know about QA Driver 20261018?` and verify it does not create or modify a row.
8. Send `Delete driver named QA Driver 20261018` and verify the bot says confirmation is not implemented and the row remains active.
9. Test a voice note only after text-path results are correct; verify the transcript, action outcome, and database row.
10. Inspect application logs for errors and confirm webhook retries do not create duplicate records.

## Gate 4 — production decision

Do not merge or enable the flag in production until the isolated test evidence is reviewed, confirmation handling is implemented for consequential writes, and the full agent scope is agreed. This runbook does not authorize production data changes.
