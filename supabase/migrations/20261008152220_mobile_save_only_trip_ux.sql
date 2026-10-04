-- Bill files are selected locally. This transaction runs only after explicit Save.
alter table public.delivery_trips add column mobile_bill_save_request jsonb;
create index delivery_trips_completed_active_idx on public.delivery_trips(completed_at)
where completed_at is not null and removed_at is null;
create index delivery_trips_pending_active_idx on public.delivery_trips(company_id,id)
where completed_at is null and removed_at is null and status<>'cancelled';

create function public.mobile_save_bill_trip(p_request_id uuid,p_company_id uuid,p_driver_id uuid,p_message_ids uuid[],p_name text default null)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare ids uuid[]; payload jsonb; existing public.delivery_trips%rowtype; m uuid;
begin
 if p_request_id is null or p_company_id is null or p_driver_id is null then raise exception 'Choose company and driver'; end if;
 select array_agg(distinct x order by x) into ids from unnest(p_message_ids) x where x is not null;
 if coalesce(cardinality(ids),0) not between 1 and 30 or cardinality(ids)<>cardinality(p_message_ids) then raise exception 'Choose 1–30 different bills'; end if;
 if char_length(coalesce(btrim(p_name),''))>160 then raise exception 'Trip name is too long'; end if;
 payload:=jsonb_build_object('companyId',p_company_id,'driverId',p_driver_id,'bills',to_jsonb(ids),'name',nullif(btrim(p_name),''));
 perform pg_advisory_xact_lock(hashtextextended('mobile-bill-save:'||p_request_id::text,0));
 select * into existing from public.delivery_trips where id=p_request_id for update;
 if found then
  if existing.mobile_bill_save_request is distinct from payload then raise exception 'Request identity conflict'; end if;
  if existing.removed_at is not null then raise exception 'Trip was removed. Refresh before continuing.'; end if;
  return jsonb_build_object('status','already_saved');
 end if;
 if not exists(select 1 from public.stock_companies where id=p_company_id and active) then raise exception 'Company unavailable'; end if;
 if not exists(select 1 from public.ops_drivers where id=p_driver_id and active) then raise exception 'Driver unavailable'; end if;
 insert into public.delivery_trips(id,sender_phone,company_id,driver_id,display_name,custom_name,mobile_bill_save_request)
 values(p_request_id,'mobile:'||p_request_id::text,p_company_id,p_driver_id,'Trip',nullif(btrim(p_name),''),payload);
 foreach m in array ids loop
  perform public.mobile_attach_trip_bill(p_request_id,m);
 end loop;
 -- Review-required bills remain visible in one saved collecting group.
 -- Never mark them ready, deduct stock here, or create an empty group.
 perform public.mobile_update_trip(p_request_id,p_driver_id,false);
 if not exists(select 1 from public.trip_documents b join public.document_drafts d on d.id=b.draft_id where b.trip_id=p_request_id and (d.workflow_status<>'recorded' or d.stock_status<>'applied')) then
  perform public.mobile_update_trip(p_request_id,p_driver_id,true);
 end if;
 return jsonb_build_object('status','saved');
end $$;
revoke all on function public.mobile_save_bill_trip(uuid,uuid,uuid,uuid[],text) from public,anon,authenticated;
grant execute on function public.mobile_save_bill_trip(uuid,uuid,uuid,uuid[],text) to service_role;

-- Exact, bounded summaries, independent of the launch screen's 60-trip window.
create function public.get_mobile_trip_activity()
returns jsonb language sql stable security invoker set search_path=public as $$
 with bounds as (
  select (now() at time zone 'Asia/Kolkata')::date as today
 ), membership as (
  select t.id,t.company_id,t.completed_at from public.delivery_trips t
  where t.entry_mode='manual' and t.removed_at is null and t.status<>'cancelled'
   and (t.completed_at is null or (t.completed_at >= (((select today from bounds)-29)::timestamp at time zone 'Asia/Kolkata') and t.completed_at < (((select today from bounds)+1)::timestamp at time zone 'Asia/Kolkata')))
   and exists(select 1 from public.manual_trip_items i where i.trip_id=t.id)
  union
  select t.id,coalesce(d.stock_company_id,c.id,t.company_id),t.completed_at
  from public.delivery_trips t join public.trip_documents b on b.trip_id=t.id
  join public.document_drafts d on d.id=b.draft_id
  left join public.stock_companies c on c.gstin=upper(regexp_replace(d.supplier_gstin,'[^A-Za-z0-9]','','g'))
  where t.entry_mode='bills' and t.removed_at is null and t.status<>'cancelled'
   and (t.completed_at is null or (t.completed_at >= (((select today from bounds)-29)::timestamp at time zone 'Asia/Kolkata') and t.completed_at < (((select today from bounds)+1)::timestamp at time zone 'Asia/Kolkata')))
   and d.workflow_status<>'cancelled' and d.stock_status<>'duplicate_document'
 ), scoped as (
  select * from membership where company_id is not null
  union
  select id,null::uuid,completed_at from membership
 ), pending as (
  select company_id,count(distinct id) as count from scoped where completed_at is null group by company_id
 ), daily as (
  select company_id,(completed_at at time zone 'Asia/Kolkata')::date as day,count(distinct id) as count
  from scoped,bounds where completed_at >= ((today-29)::timestamp at time zone 'Asia/Kolkata')
   and completed_at < ((today+1)::timestamp at time zone 'Asia/Kolkata')
  group by company_id,(completed_at at time zone 'Asia/Kolkata')::date
 )
 select jsonb_build_object('today',(select today::text from bounds),
  'pending',coalesce((select jsonb_agg(jsonb_build_object('companyId',company_id,'count',count)) from pending),'[]'::jsonb),
  'daily',coalesce((select jsonb_agg(jsonb_build_object('companyId',company_id,'day',day::text,'count',count) order by day) from daily),'[]'::jsonb));
$$;
revoke all on function public.get_mobile_trip_activity() from public,anon,authenticated;
grant execute on function public.get_mobile_trip_activity() to service_role;
