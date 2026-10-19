-- Add covering indexes for foreign keys identified by the production
-- Supabase advisor. This supports joins and parent-row updates/deletes without
-- changing data or foreign-key semantics.

create index if not exists delivery_trips_driver_id_idx
  on public.delivery_trips (driver_id);

create index if not exists delivery_trips_started_by_message_id_idx
  on public.delivery_trips (started_by_message_id);

create index if not exists document_actions_source_message_id_idx
  on public.document_actions (source_message_id);

create index if not exists document_edit_sessions_draft_id_idx
  on public.document_edit_sessions (draft_id);

create index if not exists document_edit_sessions_target_item_id_idx
  on public.document_edit_sessions (target_item_id);

create index if not exists manual_trip_items_product_id_idx
  on public.manual_trip_items (product_id);

create index if not exists ops_driver_action_confirmations_driver_id_idx
  on public.ops_driver_action_confirmations (driver_id);

create index if not exists trip_documents_draft_id_idx
  on public.trip_documents (draft_id);
