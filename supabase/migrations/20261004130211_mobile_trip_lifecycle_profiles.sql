-- Mobile-only labels and completion do not alter bill or stock movements.
alter table public.delivery_trips add column custom_name text check(custom_name is null or char_length(btrim(custom_name)) between 1 and 160);
alter table public.delivery_trips add column completed_at timestamptz;
alter table public.delivery_trips add column removed_at timestamptz;
create function public.preserve_trip_custom_name() returns trigger
language plpgsql security invoker set search_path=public as $$
begin
 if new.custom_name is not null then new.display_name:=new.custom_name; end if;
 return new;
end $$;
revoke all on function public.preserve_trip_custom_name() from public,anon,authenticated;
create trigger delivery_trip_custom_name before insert or update on public.delivery_trips for each row execute function public.preserve_trip_custom_name();

create table public.mobile_trip_actions (
 request_id uuid primary key,
 trip_id uuid not null references public.delivery_trips(id),
 action text not null check(action in ('rename','complete','remove')),
 previous_value jsonb not null,
 new_value jsonb not null,
 created_at timestamptz not null default now()
);
alter table public.mobile_trip_actions enable row level security;
revoke all on public.mobile_trip_actions from public,anon,authenticated;
grant select,insert on public.mobile_trip_actions to service_role;
create index mobile_trip_actions_trip_idx on public.mobile_trip_actions(trip_id);

create function public.mobile_trip_action(p_trip_id uuid,p_request_id uuid,p_action text,p_name text default null)
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
 values(p_request_id,t.id,p_action,jsonb_build_object('name',t.display_name,'status',t.status,'completedAt',t.completed_at),after_value);
 return jsonb_build_object('status','saved');
end $$;
revoke all on function public.mobile_trip_action(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.mobile_trip_action(uuid,uuid,text,text) to service_role;

-- Tiny profile photos load only when opening Profile, never in the home payload.
alter table public.stock_companies add column photo_png text check(photo_png is null or char_length(photo_png)<=131072);
alter table public.stock_companies add column profile_label text check(profile_label is null or char_length(btrim(profile_label)) between 1 and 200);
