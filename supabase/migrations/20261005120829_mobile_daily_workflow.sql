-- Manual dispatch is distinct from bill capture; no fake PDF/draft is created.
alter table public.delivery_trips add column entry_mode text not null default 'bills' check(entry_mode in ('bills','manual'));
alter table public.delivery_trips add column site_count integer not null default 1 check(site_count between 1 and 1000);
alter table public.delivery_trips add column owner_name text;
create table public.manual_trip_items (
 trip_id uuid not null references public.delivery_trips(id),
 product_id uuid not null references public.stock_products(id),
 quantity numeric(18,3) not null check(quantity>0 and quantity<=1000000000),
 primary key(trip_id,product_id)
);
alter table public.manual_trip_items enable row level security;
revoke all on public.manual_trip_items from public,anon,authenticated;
grant select,insert on public.manual_trip_items to service_role;
alter table public.stock_ledger add column manual_trip_id uuid references public.delivery_trips(id);
alter table public.stock_ledger drop constraint stock_ledger_movement_type_check;
alter table public.stock_ledger add constraint stock_ledger_movement_type_check check(movement_type in ('opening','stock_in','stock_out','correction','reversal','adjustment','dispatch_inferred','manual_out'));
alter table public.stock_ledger drop constraint stock_ledger_check;
alter table public.stock_ledger add constraint stock_ledger_check check(
 (movement_type in ('opening','stock_in') and draft_id is null and document_item_id is null and manual_trip_id is null and quantity_delta>0)
 or (movement_type='adjustment' and draft_id is null and document_item_id is null and manual_trip_id is null)
 or (movement_type in ('stock_out','correction','reversal') and draft_id is not null and manual_trip_id is null)
 or (movement_type='dispatch_inferred' and draft_id is not null and document_item_id is null and manual_trip_id is null and quantity_delta>0)
 or (movement_type='manual_out' and draft_id is null and document_item_id is null and manual_trip_id is not null and quantity_delta<0)
);
create index stock_ledger_manual_trip_idx on public.stock_ledger(manual_trip_id) where manual_trip_id is not null;

create function public.mobile_manual_dispatch(p_request_id uuid,p_company_id uuid,p_destination text,p_driver_id uuid,p_site_count integer,p_owner text,p_items jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare t public.delivery_trips%rowtype; i record; n integer;
begin
 perform pg_advisory_xact_lock(hashtextextended('manual-trip:'||p_request_id::text,0));
 select * into t from public.delivery_trips where id=p_request_id;
 if found then
  if t.entry_mode<>'manual' or t.company_id<>p_company_id then raise exception 'Request identity conflict'; end if;
  return jsonb_build_object('id',t.id,'status','already_saved');
 end if;
 if nullif(btrim(p_destination),'') is null or length(p_destination)>200 then raise exception 'Enter a place'; end if;
 if p_site_count is null or p_site_count<1 or p_site_count>1000 then raise exception 'Enter a valid site count'; end if;
 if not exists(select 1 from public.stock_companies where id=p_company_id and active) then raise exception 'Choose a company'; end if;
 if not exists(select 1 from public.ops_drivers where id=p_driver_id and active) then raise exception 'Choose a driver'; end if;
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)<1 or jsonb_array_length(p_items)>30 then raise exception 'Add products and quantities'; end if;
 select count(*) into n from jsonb_to_recordset(p_items) as x("productId" uuid,quantity numeric);
 if exists(select 1 from jsonb_to_recordset(p_items) as x("productId" uuid,quantity numeric) left join public.stock_products p on p.id=x."productId" and p.company_id=p_company_id and p.active where p.id is null or x.quantity is null or x.quantity<=0 or x.quantity>1000000000 or x.quantity<>round(x.quantity,3)) then raise exception 'Check product company and quantity'; end if;
 if (select count(distinct x."productId") from jsonb_to_recordset(p_items) as x("productId" uuid,quantity numeric))<>n then raise exception 'Product appears twice'; end if;
 for i in select p.id from public.stock_products p join jsonb_to_recordset(p_items) as x("productId" uuid,quantity numeric) on p.id=x."productId" order by p.id loop
  perform 1 from public.stock_products where id=i.id for update;
 end loop;
 insert into public.delivery_trips(id,sender_phone,company_id,entry_mode,display_name,primary_destination,driver_id,site_count,owner_name,status,finalized_at)
 values(p_request_id,'mobile:'||p_request_id::text,p_company_id,'manual',btrim(p_destination),btrim(p_destination),p_driver_id,p_site_count,nullif(btrim(p_owner),''),'ready',now());
 insert into public.manual_trip_items(trip_id,product_id,quantity) select p_request_id,x."productId",x.quantity from jsonb_to_recordset(p_items) as x("productId" uuid,quantity numeric);
 insert into public.stock_ledger(product_id,manual_trip_id,movement_type,quantity_delta,idempotency_key)
 select product_id,p_request_id,'manual_out',-quantity,'manual-trip:'||p_request_id::text||':'||product_id::text from public.manual_trip_items where trip_id=p_request_id;
 return jsonb_build_object('id',p_request_id,'status','saved');
end $$;
revoke all on function public.mobile_manual_dispatch(uuid,uuid,text,uuid,integer,text,jsonb) from public,anon,authenticated;
grant execute on function public.mobile_manual_dispatch(uuid,uuid,text,uuid,integer,text,jsonb) to service_role;

-- Candidate names from canonical recorded bills are suggestions, not invented balances.
create function public.get_mobile_product_catalog()
returns table(product_id uuid,company_id uuid,product_name text,unit text,hsn_sac text)
language sql stable security invoker set search_path=public as $$
 select p.id,p.company_id,p.canonical_name,p.unit,p.hsn_sac from public.stock_products p where p.active
 union all
 select distinct null::uuid,c.id,i.description,i.unit,i.hsn_sac
 from public.document_items i join public.document_drafts d on d.id=i.draft_id
 join public.stock_companies c on c.active and (c.id=d.stock_company_id or (d.stock_company_id is null and c.gstin=upper(regexp_replace(d.supplier_gstin,'[^A-Za-z0-9]','','g'))))
 where d.workflow_status='recorded' and d.stock_status<>'duplicate_document' and nullif(btrim(i.unit),'') is not null
 and not exists(select 1 from public.stock_document_claims k where k.identity_key='doc:'||upper(regexp_replace(d.supplier_gstin,'[^A-Za-z0-9]','','g'))||':'||upper(regexp_replace(d.document_number,'[^A-Za-z0-9]','','g')) and k.draft_id<>d.id)
 and not exists(select 1 from public.stock_products p where p.active and p.company_id=c.id and p.normalized_name=i.normalized_description and p.normalized_unit=regexp_replace(upper(i.unit),'[^A-Z0-9]','','g'))
 order by 2,3 limit 2000;
$$;
revoke all on function public.get_mobile_product_catalog() from public,anon,authenticated;
grant execute on function public.get_mobile_product_catalog() to service_role;

create function public.get_mobile_today_stock()
returns table(company_id uuid,product_id uuid,product_name text,unit text,quantity numeric)
language sql stable security invoker set search_path=public as $$
 with bounds as(select date_trunc('day',now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata' as start)
 select p.company_id,p.id,p.canonical_name,p.unit,greatest(-sum(l.quantity_delta),0)
 from public.stock_ledger l join public.stock_products p on p.id=l.product_id cross join bounds b
 where l.created_at>=b.start and l.created_at<b.start+interval '1 day' and l.movement_type in ('stock_out','manual_out','correction','reversal')
 group by p.company_id,p.id,p.canonical_name,p.unit order by p.canonical_name;
$$;
revoke all on function public.get_mobile_today_stock() from public,anon,authenticated;
grant execute on function public.get_mobile_today_stock() to service_role;

-- Inferred receipts do not establish the total physical stock. A later physical
-- count establishes it again. Preserve all existing ledger movements.
create or replace view public.stock_balances with(security_invoker=true) as
with totals as (
 select p.id as product_id,p.company_id,c.canonical_name as company_name,c.gstin as company_gstin,p.canonical_name as product_name,p.unit,p.hsn_sac,
 coalesce(sum(l.quantity_delta),0) as raw_quantity,
 max(l.created_at) filter(where l.movement_type in ('opening','adjustment')) as count_at,
 max(l.created_at) filter(where l.movement_type='dispatch_inferred') as inferred_at,
 min(l.created_at) filter(where l.movement_type='stock_in') as incoming_at,
 min(l.created_at) filter(where l.movement_type in ('stock_out','manual_out')) as outgoing_at
 from public.stock_products p join public.stock_companies c on c.id=p.company_id left join public.stock_ledger l on l.product_id=p.id where p.active
 group by p.id,p.company_id,c.canonical_name,c.gstin,p.canonical_name,p.unit,p.hsn_sac
), known as (
 select *,raw_quantity>=0 and ((count_at is not null and (inferred_at is null or count_at>inferred_at)) or (inferred_at is null and incoming_at is not null and (outgoing_at is null or incoming_at<=outgoing_at))) as balance_known from totals
)
select product_id,company_id,company_name,company_gstin,product_name,unit,hsn_sac,greatest(raw_quantity,0) as current_quantity,balance_known from known;

-- Explicit physical confirmation of zero must be auditable even when the
-- arithmetic delta is zero. Only adjustment rows may have zero delta.
alter table public.stock_ledger drop constraint stock_ledger_quantity_delta_check;
alter table public.stock_ledger add constraint stock_ledger_quantity_delta_check check(quantity_delta<>0 or movement_type='adjustment');
create or replace function public.adjust_stock_balance(p_product_id uuid,p_target_quantity numeric,p_idempotency_key uuid)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare p public.stock_products%rowtype; current numeric; delta numeric; key text; known boolean;
begin
 if p_target_quantity is null or p_target_quantity<0 or p_target_quantity>1000000000 then return jsonb_build_object('status','not_ready','product_id',p_product_id); end if;
 key:='adjust:'||p_idempotency_key::text;
 select * into p from public.stock_products where id=p_product_id and active for update;
 if not found then return jsonb_build_object('status','not_ready','product_id',p_product_id); end if;
 if exists(select 1 from public.stock_ledger where idempotency_key=key) then return jsonb_build_object('status','already_adjusted','product_id',p_product_id,'target_quantity',p_target_quantity); end if;
 select coalesce(sum(quantity_delta),0) into current from public.stock_ledger where product_id=p_product_id;
 select balance_known into known from public.stock_balances where product_id=p_product_id;
 delta:=p_target_quantity-current;
 if delta=0 and known then return jsonb_build_object('status','no_change','product_id',p_product_id,'previous_quantity',current,'target_quantity',p_target_quantity); end if;
 insert into public.stock_ledger(product_id,movement_type,quantity_delta,idempotency_key,created_at) values(p_product_id,'adjustment',delta,key,clock_timestamp());
 return jsonb_build_object('status','adjusted','product_id',p_product_id,'previous_quantity',current,'target_quantity',p_target_quantity);
end $$;
revoke all on function public.adjust_stock_balance(uuid,numeric,uuid) from public,anon,authenticated;
grant execute on function public.adjust_stock_balance(uuid,numeric,uuid) to service_role;
