# Production schema audit snapshot

**Audit date:** 2026-10-19  
**Supabase project:** jmvbcjpuxmdrqjxnoloy  
**Method:** read-only catalog queries, Supabase migration history, repository migration-tree comparison, and Supabase security/performance advisors. No operational rows were changed by the audit.

## Inventory observed

| Object | Count |
|---|---:|
| Public base tables | 20 |
| Public views | 2 |
| Public functions | 25 |
| Public indexes | 77 |
| Public triggers | 8 |
| Public RLS policies | 0 |
| Public constraints | 233 |
| Client-role table grants (anon + authenticated) | 0 |
| Client-role routine grants (anon + authenticated) | 0 |

Constraint count is 173 CHECK, 26 FOREIGN KEY, 20 PRIMARY KEY, and 14 UNIQUE constraints.

All 20 public base tables have RLS enabled. The application accesses these operational tables through server-side service-role code; no browser/WhatsApp client role should query them directly. With no policies and no table/routine grants to anon or authenticated, direct client-role access is denied.

The two views are stock_balances and stock_history.

## Privilege findings and remediation

The audit initially found unnecessary direct grants to anon and authenticated on whatsapp_messages, document_drafts, document_items, and whatsapp_outbound_messages. RLS without policies already blocked ordinary row access, but the broad grants were not least-privilege (including TRUNCATE/trigger-related grants).

Remediation applied through reviewed migrations:

- 20261019131725_core_table_least_privilege: revoke PUBLIC, anon, and authenticated grants on those four tables; revoke client-role EXECUTE on set_updated_at().
- 20261019131925_core_table_service_role_crud: restrict those four tables' service_role grants to SELECT/INSERT/UPDATE/DELETE only.

Post-remediation catalog verification confirmed:
- zero table grants to anon or authenticated across public;
- zero routine grants to anon or authenticated across public;
- exactly CRUD privileges for service_role on each of the four core tables;
- set_updated_at() EXECUTE is granted to service_role and the database owner, not client roles.

The migrations change grants only; they do not alter operational rows or stock balances. Isolated PostgreSQL CI checks these permissions.

## Migration history

Live Supabase history contains 33 migrations. PR #98 aligned the two privilege-migration filenames with the versions already recorded by Supabase. The foreign-key index migration was then applied successfully; Supabase recorded version 20261019132855_fk_supporting_indexes. This PR renames the checked-in file to that exact recorded version without changing SQL or editing live migration history.

**Post-merge verification: PASS — exact 33/33 version-and-name match.** A fresh comparison of every checked-in migration filename against live Supabase version/name entries returned no missing repository migrations and no missing live migrations.

## Advisor findings and remediation

The production Supabase advisor originally reported eight foreign keys without a covering index. PR #100 added these indexes through migration fk_supporting_indexes:

- delivery_trips_driver_id_idx
- delivery_trips_started_by_message_id_idx
- document_actions_source_message_id_idx
- document_edit_sessions_draft_id_idx
- document_edit_sessions_target_item_id_idx
- manual_trip_items_product_id_idx
- ops_driver_action_confirmations_driver_id_idx
- trip_documents_draft_id_idx

Post-migration advisor refresh: **zero unindexed-foreign-key findings**. The advisor now reports 15 unused indexes, including the eight newly added FK indexes. This is an observation-window signal, not proof they are unnecessary: the live operational tables have low row counts and little observed query load. Keep them until representative workload/EXPLAIN evidence supports any removal.

The seven pre-existing unused-index findings are ops_driver_action_confirmations_pending_sender_idx, stock_ledger_manual_trip_idx, document_items_normalized_description_idx, document_edit_sessions_expires_at_idx, delivery_trips_completed_active_idx, delivery_trips_pending_active_idx, and ops_drivers_active_name_idx.

The security advisor's RLS-enabled/no-policy notices are consistent with the server-only access design described above. Any future browser-side database access must introduce explicit, scoped policies and least-privilege grants first.

## Drift assessment

**PARTIAL — migration-history reconciliation and security/grant/index inventory are verified.** This audit confirms object counts, RLS state, client-role grants, core table grants, the eight new FK indexes, and current advisor findings. It is not a complete automated definition-by-definition diff of every column default, CHECK expression, index expression, trigger body, view definition, function body, or grant against the repository SQL. A catalog-to-migration structural diff remains required before claiming zero schema drift.
