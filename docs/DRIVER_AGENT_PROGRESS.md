# Driver Agent — Progress and Safety Record

## Current milestone

Driver-agent create/list handling and sender-scoped deactivation confirmation are implemented on PR #60. The PR targets `agent/driver-automation-continuation`; it is not merged to `main`, and the production feature flag remains disabled.

## Runtime behavior

- Explicit driver-list requests return active drivers in stable alphabetical order, capped at 50 with a truncation notice when more records exist.
- Driver creation normalizes names, prevents duplicate normalized names, verifies the persisted row before claiming success, and fails closed on lookup/insert/verification errors.
- Deactivation requires an exact `CONFIRM DRIVER <token>` reply from the same WhatsApp sender.
- Tokens use 192 bits of cryptographic randomness; only SHA-256 hashes are stored. Tokens expire after five minutes and are single-use.
- A PostgreSQL function locks the confirmation row, validates sender/action/expiry/consumption, updates the referenced active driver, and consumes the token atomically.
- Confirmation table access is revoked from `public`, `anon`, and `authenticated`; the RPC is executable only by `service_role`.

## Database migrations

1. `supabase/migrations/20261018115900_ops_drivers_catalog.sql` provides a reproducible catalog schema for fresh environments.
2. `supabase/migrations/20261018120000_ops_driver_deactivation_confirmation.sql` creates confirmation storage and the atomic confirmation RPC.

Read-only inspection of the live `public.ops_drivers` catalog confirmed columns `id`, `name`, `normalized_name`, `active`, `last_used_at`, `created_at`, and `updated_at`; a UUID primary key; unique `normalized_name`; and name/normalized-name length checks from 1 to 120 characters. The checked-in bootstrap migration matches those column types and constraint semantics. No production rows were read or changed as part of handler tests.

## Verification evidence

- GitHub Actions run [39131919476](https://github.com/Shijastk/solar-ops-whatsapp/actions/runs/39131919476) passed on exact PR head `7bbfcb3465fde8d69d32976eaca956c46c44d3bf`.
- Passed checks: dependency installation, TypeScript typecheck, lint, unit tests, production build, and the isolated PostgreSQL 16 migration/integration job.
- PostgreSQL integration tests cover migration application, successful deactivation, wrong-sender rejection, expired-token rejection, and replay rejection.
- Handler unit tests use mocked Supabase and reply transport. No WhatsApp messages were sent.

## Rollout boundary / remaining work

- Migrations have only been applied to disposable PostgreSQL in CI, not to Supabase.
- Before production rollout, review the PR and migration diff, validate in an isolated Supabase environment if available, and apply migrations through the approved deployment process.
- Keep `SOLAR_OPS_DRIVER_AGENT_ENABLED` disabled until rollout is explicitly authorized.
- Do not merge this work into `main` or enable the production feature flag without explicit authorization.
