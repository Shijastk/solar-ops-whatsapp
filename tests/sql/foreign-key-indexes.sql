-- Assert the foreign-key indexes identified by the production advisor exist
-- after applying the full migration chain to isolated PostgreSQL.
do $test$
declare
  v_index text;
  v_indexes text[] := array[
    'delivery_trips_driver_id_idx',
    'delivery_trips_started_by_message_id_idx',
    'document_actions_source_message_id_idx',
    'document_edit_sessions_draft_id_idx',
    'document_edit_sessions_target_item_id_idx',
    'manual_trip_items_product_id_idx',
    'ops_driver_action_confirmations_driver_id_idx',
    'trip_documents_draft_id_idx'
  ];
begin
  foreach v_index in array v_indexes loop
    if to_regclass('public.' || v_index) is null then
      raise exception 'missing expected foreign-key index %', v_index;
    end if;
  end loop;
end
$test$;

select 'PASS: production-advisor foreign-key indexes exist' as result;
