-- Snapshot removed group membership before allowing an explicit reattachment.
create or replace function public.mobile_trip_action(p_trip_id uuid,p_request_id uuid,p_action text,p_name text default null)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare t public.delivery_trips%rowtype; a public.mobile_trip_actions%rowtype; after_value jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('trip-action:'||p_request_id::text,0));
 select * into a from public.mobile_trip_actions where request_id=p_request_id;
 if found then
  if a.trip_id<>p_trip_id or a.action<>p_action then raise exception 'Request identity conflict'; end if;
  return jsonb_build_object('status','already_saved');
 end if;
 select * into t from public.delivery_trips where id=p_trip_id for update;
 if not found or t.removed_at is not null then raise exception 'Trip unavailable'; end if;
 if p_action='rename' then
  if nullif(btrim(p_name),'') is null or char_length(btrim(p_name))>160 then raise exception 'Enter a trip name (up to 160 characters)'; end if;
  update public.delivery_trips set custom_name=btrim(p_name),updated_at=now() where id=t.id;
  after_value:=jsonb_build_object('name',btrim(p_name));
 elsif p_action='complete' then
  if t.status<>'ready' then raise exception 'Make the trip ready before marking completed'; end if;
  if not exists(select 1 from public.manual_trip_items where trip_id=t.id) and not exists(select 1 from public.trip_documents b join public.document_drafts d on d.id=b.draft_id where b.trip_id=t.id and d.workflow_status<>'cancelled' and d.stock_status<>'duplicate_document') then raise exception 'This trip has no products or bills'; end if;
  if t.entry_mode='bills' and exists(select 1 from public.trip_documents b left join public.document_drafts d on d.id=b.draft_id where b.trip_id=t.id and (b.processing_status<>'parsed' or d.id is null or (d.stock_status<>'duplicate_document' and d.workflow_status<>'cancelled' and (d.workflow_status<>'recorded' or d.stock_status<>'applied')))) then raise exception 'Check the bills before marking completed'; end if;
  update public.delivery_trips set completed_at=coalesce(completed_at,now()),updated_at=now() where id=t.id;
  after_value:=jsonb_build_object('completed',true);
 elsif p_action='remove' then
  -- Removing a group is not a physical return or bill cancellation.
  update public.delivery_trips set removed_at=now(),status='cancelled',updated_at=now() where id=t.id;
  after_value:=jsonb_build_object('removed',true);
 else raise exception 'Unknown trip action'; end if;
 insert into public.mobile_trip_actions(request_id,trip_id,action,previous_value,new_value)
 values(p_request_id,t.id,p_action,jsonb_build_object('name',t.display_name,'status',t.status,'completedAt',t.completed_at,'billLinks',(select coalesce(jsonb_agg(to_jsonb(b)),'[]'::jsonb) from public.trip_documents b where b.trip_id=t.id)),after_value);
 return jsonb_build_object('status','saved');
end $$;
revoke all on function public.mobile_trip_action(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.mobile_trip_action(uuid,uuid,text,text) to service_role;


create or replace function public.mobile_attach_trip_bill(p_trip_id uuid,p_message_id uuid)
returns jsonb language plpgsql set search_path=public as $$
declare t public.delivery_trips%rowtype; d public.document_drafts%rowtype; former_id uuid;
begin
 select * into t from public.delivery_trips where id=p_trip_id for update;
 if not found or t.status<>'collecting' then raise exception 'This trip is closed'; end if;
 select * into d from public.document_drafts where message_id=p_message_id for update;
 if not found or d.workflow_status='cancelled' then raise exception 'Bill unavailable'; end if;
 if d.stock_status='duplicate_document' then raise exception 'Already uploaded. Use the original bill.'; end if;
 if t.company_id is not null and d.stock_company_id is distinct from t.company_id and not exists(select 1 from public.stock_companies c where c.id=t.company_id and c.gstin=upper(regexp_replace(d.supplier_gstin,'[^A-Za-z0-9]','','g'))) then raise exception 'Bill belongs to another company'; end if;
 if exists(select 1 from public.trip_documents where message_id=p_message_id and trip_id=p_trip_id) then return jsonb_build_object('status','already_attached'); end if;
 select trip_id into former_id from public.trip_documents where message_id=p_message_id;
 if former_id is not null then
  if not exists(select 1 from public.delivery_trips where id=former_id and removed_at is not null) then raise exception 'Bill already belongs to a trip'; end if;
  if not exists(select 1 from public.mobile_trip_actions where trip_id=former_id and action='remove' and previous_value->'billLinks' @> jsonb_build_array(jsonb_build_object('message_id',p_message_id))) then raise exception 'Original trip audit unavailable'; end if;
  update public.trip_documents set trip_id=p_trip_id,updated_at=now() where trip_id=former_id and message_id=p_message_id;
  return jsonb_build_object('status','attached');
 end if;
 insert into public.trip_documents(trip_id,message_id,draft_id,processing_status) values(p_trip_id,p_message_id,d.id,'parsed');
 return jsonb_build_object('status','attached');
end $$;

revoke all on function public.mobile_attach_trip_bill(uuid,uuid) from public,anon,authenticated;
grant execute on function public.mobile_attach_trip_bill(uuid,uuid) to service_role;
