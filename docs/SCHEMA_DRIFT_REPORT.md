# Production schema audit snapshot

**Audit date:** 2026-10-19  
**Supabase project:** `jmvbcjpuxmdrqjxnoloy`  
**Method:** read-only catalog queries, Supabase migration history, repository migration-tree comparison, and Supabase security/performance advisors. No operational rows were changed by the audit.

## Inventory observed

| Object | Count |
|---|---:|
| Public base tables | 20 |
| Public views | 2 |
| Public functions | 25 |
| Public indexes | 69 |
| Public triggers | 8 |
| Public RLS policies | 0 |
| Public constraints | 233 |
| Client-role table grants (`anon` + `authenticated`) | 0 |
| Client-role routine grants (`anon` + `authenticated`) | 0 |

Constraint count is 173 CHECK, 26 FOREIGN KEY, 20 PRIMARY KEY, and 14 UNIQUE constraints.

All 20 public base tables have RLS enabled. The application accesses these operational tables through server-side service-role code; no browser/WhatsApp client role should query them directly. With no policies and no table/routine grants to `anon` or `authenticated`, direct client-role access is denied.

The two views are `stock_balances` and `stock_history`.

## Privilege findings and remediation

The audit initially found unnecessary direct grants to `anon` and `authenticated` on `whatsapp_messages`, `document_drafts`, `document_items`, and `whatsapp_outbound_messages`. RLS without policies already blocked ordinary row access, but the broad grants were not least-privilege (including TRUNCATE/trigger-related grants).

Remediation applied through reviewed migrations:

- `20261019131725_core_table_least_privilege`: revoke `PUBLIC`, `anon`, and `authenticated` grants on those four tables; revoke client-role EXECUTE on `set_updated_at()`.
- `20261019131925_core_table_service_role_crud`: restrict those four tables' `service_role` grants to SELECT/INSERT/UPDATE/DELETE only.

Post-remediation catalog verification confirmed:
- zero table grants to `anon` or `authenticated` across `public`;
- zero routine grants to `anon` or `authenticated` across `public`;
- exactly CRUD privileges for `service_role` on each of the four core tables;
- `set_updated_at()` EXECUTE is granted to `service_role` and the database owner, not client roles.

The migrations change grants only; they do not alter operational rows or stock balances. Isolated PostgreSQL CI checks these permissions.

## Migration history

Live Supabase history contains 32 migrations. Before PR #98, the two newly applied privilege migrations had equivalent SQL but repository filenames with different timestamps. PR #98 renamed those two repository files to match the versions actually recorded by Supabase; it did not edit live migration history or change migration SQL.

**Post-merge verification: PASS — exact 32/32 version-and-name match.** A fresh comparison of all checked-in migration filenames against live Supabase `version_name` entries returned no missing repository migrations and no missing live migrations.

## Advisor findings requiring follow-up

Supabase's performance advisor reports eight foreign keys without a covering index:

- `delivery_trips_driver_id_fkey`
- `delivery_trips_started_by_message_id_fkey`
- `document_actions_source_message_id_fkey`
- `document_edit_sessions_draft_id_fkey`
- `document_edit_sessions_target_item_id_fkey`
- `manual_trip_items_product_id_fkey`
- `ops_driver_action_confirmations_driver_id_fkey`
- `trip_documents_draft_id_fkey`

It also reports seven indexes as unused in the advisor's observation window: `ops_driver_action_confirmations_pending_sender_idx`, `stock_ledger_manual_trip_idx`, `document_items_normalized_description_idx`, `document_edit_sessions_expires_at_idx`, `delivery_trips_completed_active_idx`, `delivery_trips_pending_active_idx`, and `ops_drivers_active_name_idx`. These are informational signals only; do not drop indexes without query/workload evidence.

The security advisor's RLS-enabled/no-policy notices are consistent with the server-only access design described above. Any future browser-side database access must introduce explicit, scoped policies and least-privilege grants first.

## Drift assessment

**PARTIAL — migration-history reconciliation and security/grant inventory are verified.** This audit confirms object counts, RLS state, client-role grants, core table grants, and the listed advisor findings. It is not a complete automated definition-by-definition diff of every column default, CHECK expression, index expression, trigger body, view definition, function body, or grant against the repository SQL. A catalog-to-migration structural diff remains required before claiming zero schema drift.
