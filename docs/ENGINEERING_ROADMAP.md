# Solar Ops Engineering Roadmap

## Operating rules

- Work from repository evidence, production-safe observations, and reproducible tests; do not infer success from a response message alone.
- Execute tasks in order without waiting for user confirmation between routine, reversible engineering steps.
- For each task: inspect the current implementation, state the observed gap, make the smallest safe change, add/update tests, run CI, inspect failures, fix and rerun, then update this checklist with commit/CI evidence.
- Never mark a task complete unless the relevant automated checks have passed and the evidence is recorded.
- Do not inspect or print secret values. Do not run destructive production operations, send real WhatsApp messages, or change production feature flags as part of routine testing.
- Prefer isolated test data, mocked external services, and read-only production verification. Cleanup must target only records created by the test and must be verifiable.
- Do not merge changes into `main` or enable experimental production features without explicit authorization.

## Completion states

- `NOT STARTED`: not yet investigated.
- `IN PROGRESS`: investigation or implementation underway.
- `BLOCKED`: cannot safely proceed; record the exact blocker and next safe action.
- `PASS`: implementation and required checks are evidenced as passing.
- `FAIL`: a reproducible check fails; do not proceed past the failing dependency.

## Phase 0 — CI and regression baseline

- [x] PR #57 adds driver intent parser regression cases and rejects the incomplete name `named`.
- [x] GitHub Actions CI passed on commit `f5ee58d055223c2f368fa0978c0e12010ac8d5f7`: dependency installation, TypeScript typecheck, lint, unit tests, and production build all succeeded. This validates the PR branch, not production behavior.
- [ ] Review PR #57 and merge only after the proposed changes are confirmed; no merge is performed by this roadmap.
- [ ] Ensure CI result links and commit SHAs are recorded for every future task.

## Phase 1 — Understand current behavior and establish test boundaries

- [ ] Map webhook entry points, intent routing, database access, authorization, feature flags, and response generation.
- [ ] Document which actions are implemented versus placeholders: drivers, trips, stock, bills, payments, document ingestion, and follow-up/context handling.
- [ ] Audit existing unit tests and identify integration tests that can touch production.
- [ ] Create isolated test fixtures/mocks and guard integration tests against accidentally targeting production.
- [ ] Establish baseline checks: typecheck, lint, unit tests, build; run safe integration tests only against isolated test resources.

## Phase 2 — Driver operations

- [ ] Intent parsing: create, list/read, update, deactivate/delete; Malayalam, Manglish, and English variants; incomplete/ambiguous commands must not mutate.
- [ ] Persistence behavior: normalization, duplicate protection, validation, read-after-write verification, errors.
- [ ] Confirmation and authorization rules for destructive actions; fail closed until a complete safe confirmation path exists.
- [ ] End-to-end tests against isolated database fixtures; prove duplicate and invalid requests do not create records.

## Phase 3 — Conversation context and routing

- [ ] Trace whether follow-up messages retain context and whether each turn reads only the minimum required data.
- [ ] Add tests for follow-ups, ambiguity, topic changes, stale context, and missing entities.
- [ ] Keep database queries narrow and deterministic; do not send the full database to an LLM.
- [ ] Add latency and token/data-size measurements before optimization claims.

## Phase 4 — Trips and assignments

- [ ] Inspect existing schema and actual supported trip workflows before designing changes.
- [ ] Add validated trip creation, grouping, driver assignment, and read-back checks only where the current product rules support them.
- [ ] Test empty trips, duplicate bills, multi-stop trips, invalid drivers, and repeated requests.
- [ ] Preserve save-before-create and avoid duplicate trip creation on retries.

## Phase 5 — Stock and bills

- [ ] Verify stock add/edit and bill approval behavior against the actual schema and business rules.
- [ ] Ensure only approved bills change stock, with idempotency and transaction safety where supported.
- [ ] Test duplicate bill ingestion, edits to same-day bills, invalid quantities, and concurrent/retried approvals.
- [ ] Confirm all responses are grounded in database results, not model guesses.

## Phase 6 — Payments and reconciliation

- [ ] Map existing cash/porter/driver payment records and reconciliation rules.
- [ ] Add or repair only evidence-backed workflows.
- [ ] Test duplicates, invalid amounts, partial payments, and read-after-write verification using isolated fixtures.

## Phase 7 — WhatsApp and document ingestion

- [ ] Verify webhook signature checks, sender allowlists/authorization, retries, idempotency, and media/document lifecycle.
- [ ] Exercise signed synthetic webhooks only against a dedicated test deployment/database.
- [ ] Prove tests cannot delete unrelated records or send unintended real messages.
- [ ] Keep Meta credentials and other secrets out of logs, PR comments, and generated reports.

## Phase 8 — Release readiness

- [ ] Run all required CI checks on the final candidate commit.
- [ ] Run safe isolated integration tests and record their target environment and result.
- [ ] Verify production deployment SHA and health without mutating production data.
- [ ] Maintain a known-limitations list; do not claim unimplemented features are complete.
- [ ] Production rollout and any feature-flag changes require explicit authorization.

## Task log

| Date (UTC) | Task | Commit / CI evidence | Result |
|---|---|---|---|
| 2026-10-18 | Driver parser regression coverage and incomplete-name guard | `f5ee58d055223c2f368fa0978c0e12010ac8d5f7`; GitHub Actions run `39126065877` succeeded, including typecheck, lint, unit tests, and production build | PASS on PR branch; not merged |
