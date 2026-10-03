-- Preserve business-document identity before any inferred receipt or stock-out.
alter table public.stock_company_aliases drop constraint stock_company_aliases_source_check;
alter table public.stock_company_aliases add constraint stock_company_aliases_source_check check (source in ('canonical','operator','document'));
alter table public.stock_document_claims drop constraint if exists stock_document_claims_draft_id_key;
create index if not exists stock_document_claims_draft_idx on public.stock_document_claims(draft_id);
create or replace function public.claim_stock_document(p_draft_id uuid) returns jsonb
language plpgsql set search_path = public as $$
declare d public.document_drafts%rowtype; keys text[] := '{}'; k text; owner_id uuid;
begin
 select * into d from public.document_drafts where id=p_draft_id for update;
 if not found or d.parse_status <> 'approved' or d.workflow_status <> 'recorded' then
  return jsonb_build_object('status','not_ready','draft_id',p_draft_id);
 end if;
 if d.stock_status='reversed' then
  return jsonb_build_object('status','inconsistent','reason','already_reversed','draft_id',p_draft_id);
 end if;
 if nullif(d.supplier_gstin,'') is not null and nullif(d.document_number,'') is not null then
  keys := array_append(keys,'doc:'||upper(regexp_replace(d.supplier_gstin,'[^A-Za-z0-9]','','g'))||':'||upper(regexp_replace(d.document_number,'[^A-Za-z0-9]','','g')));
 end if;
 if nullif(d.eway_bill_number,'') is not null then
  keys := array_append(keys,'eway:'||upper(regexp_replace(d.eway_bill_number,'[^A-Za-z0-9]','','g')));
 end if;
 if cardinality(keys)=0 then
  update public.document_drafts set stock_error='missing_document_identity',stock_updated_at=now() where id=p_draft_id;
  return jsonb_build_object('status','not_ready','reason','missing_document_identity','draft_id',p_draft_id);
 end if;
 -- Stable ordering avoids deadlocks; concurrent uploads serialize by identity.
 for k in select unnest(keys) order by 1 loop
  perform pg_advisory_xact_lock(hashtextextended(k,0));
 end loop;
 select draft_id into owner_id from public.stock_document_claims where identity_key=any(keys) and draft_id<>p_draft_id order by created_at limit 1;
 if owner_id is not null then
  update public.document_drafts set stock_status='duplicate_document',stock_error='duplicate_of:'||owner_id::text,stock_updated_at=now() where id=p_draft_id;
  return jsonb_build_object('status','duplicate_document','draft_id',p_draft_id,'original_draft_id',owner_id);
 end if;
 foreach k in array keys loop
  insert into public.stock_document_claims(identity_key,draft_id) values(k,p_draft_id) on conflict(identity_key) do nothing;
 end loop;
 return jsonb_build_object('status','claimed','draft_id',p_draft_id);
end $$;
revoke all on function public.claim_stock_document(uuid) from public,anon,authenticated;
grant execute on function public.claim_stock_document(uuid) to service_role;
-- Add the second identity to existing applied documents without replaying stock.
insert into public.stock_document_claims(identity_key,draft_id)
select distinct on (k) k,id from (
 select d.id,'doc:'||upper(regexp_replace(d.supplier_gstin,'[^A-Za-z0-9]','','g'))||':'||upper(regexp_replace(d.document_number,'[^A-Za-z0-9]','','g')) as k,d.created_at
 from public.document_drafts d where nullif(d.supplier_gstin,'') is not null and nullif(d.document_number,'') is not null
 and exists(select 1 from public.stock_ledger l where l.draft_id=d.id and l.movement_type='stock_out')
) applied order by k,created_at,id on conflict(identity_key) do nothing;
CREATE OR REPLACE FUNCTION public.apply_stock_out_for_draft(p_draft_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_draft public.document_drafts%rowtype;
  v_company public.stock_companies%rowtype;
  v_item record;
  v_product public.stock_products%rowtype;
  v_item_count integer;
  v_existing_count integer;
  v_supplier_normalized text;
  v_available numeric;
  v_required numeric;
  v_claim jsonb;
begin
  select * into v_draft
  from public.document_drafts
  where id = p_draft_id
  for update;

  if not found
     or v_draft.parse_status <> 'approved'
     or v_draft.workflow_status <> 'recorded' then
    return jsonb_build_object('status', 'not_ready', 'draft_id', p_draft_id);
  end if;

  if v_draft.stock_status = 'reversed' then
    return jsonb_build_object(
      'status', 'inconsistent',
      'draft_id', p_draft_id,
      'reason', 'already_reversed'
    );
  end if;

  v_claim := public.claim_stock_document(p_draft_id);
  if v_claim->>'status' <> 'claimed' then return v_claim; end if;

  if v_draft.stock_company_id is not null then
    select * into v_company
    from public.stock_companies
    where id = v_draft.stock_company_id and active = true;
  end if;

  if v_company.id is null and v_draft.supplier_gstin is not null then
    select * into v_company
    from public.stock_companies
    where active = true
      and gstin = regexp_replace(
        upper(v_draft.supplier_gstin),
        '[^A-Z0-9]',
        '',
        'g'
      )
    limit 1;
  end if;

  if v_company.id is null and v_draft.supplier_name is not null then
    v_supplier_normalized := regexp_replace(
      regexp_replace(
        lower(trim(v_draft.supplier_name)),
        '[^a-z0-9]+',
        ' ',
        'g'
      ),
      '[[:space:]]+',
      ' ',
      'g'
    );

    select c.* into v_company
    from public.stock_company_aliases a
    join public.stock_companies c on c.id = a.company_id
    where c.active = true
      and a.normalized_alias = v_supplier_normalized
    limit 1;
  end if;

  if v_company.id is null then
    update public.document_drafts
    set
      stock_status = 'company_unmapped',
      stock_error = 'company_unmapped',
      stock_updated_at = now()
    where id = p_draft_id;

    return jsonb_build_object(
      'status', 'company_unmapped',
      'draft_id', p_draft_id
    );
  end if;

  update public.document_drafts
  set stock_company_id = v_company.id
  where id = p_draft_id
    and stock_company_id is null;

  select count(*) into v_item_count
  from public.document_items
  where draft_id = p_draft_id;

  if v_item_count = 0 then
    update public.document_drafts
    set
      stock_status = 'invalid_item',
      stock_error = 'no_items',
      stock_updated_at = now()
    where id = p_draft_id;

    return jsonb_build_object(
      'status', 'invalid_item',
      'draft_id', p_draft_id,
      'reason', 'no_items'
    );
  end if;

  for v_item in
    select *
    from public.document_items
    where draft_id = p_draft_id
    order by line_index, id
  loop
    if v_item.quantity is null
       or v_item.quantity <= 0
       or nullif(btrim(v_item.unit), '') is null then
      update public.document_drafts
      set
        stock_status = 'invalid_item',
        stock_error = 'invalid_quantity_or_unit',
        stock_updated_at = now()
      where id = p_draft_id;

      return jsonb_build_object(
        'status', 'invalid_item',
        'draft_id', p_draft_id,
        'item_id', v_item.id,
        'description', v_item.description,
        'unit', v_item.unit,
        'reason', 'invalid_quantity_or_unit'
      );
    end if;

    v_product := null;

    select p.* into v_product
    from public.stock_product_aliases a
    join public.stock_products p
      on p.id = a.product_id
     and p.company_id = a.company_id
    where a.company_id = v_company.id
      and a.normalized_alias = v_item.normalized_description
      and a.normalized_unit = regexp_replace(
        upper(v_item.unit),
        '[^A-Z0-9]',
        '',
        'g'
      )
      and p.active = true
    limit 1;

    if v_product.id is null then
      update public.document_drafts
      set
        stock_status = 'needs_product_match',
        stock_error = 'needs_product_match',
        stock_updated_at = now()
      where id = p_draft_id;

      return jsonb_build_object(
        'status', 'needs_product_match',
        'draft_id', p_draft_id,
        'company_id', v_company.id,
        'item_id', v_item.id,
        'description', v_item.description,
        'unit', v_item.unit
      );
    end if;

    if v_item.hsn_sac is not null
       and v_product.hsn_sac is not null
       and regexp_replace(upper(v_item.hsn_sac), '[^A-Z0-9]', '', 'g')
           <> regexp_replace(upper(v_product.hsn_sac), '[^A-Z0-9]', '', 'g')
    then
      update public.document_drafts
      set
        stock_status = 'invalid_item',
        stock_error = 'hsn_mismatch',
        stock_updated_at = now()
      where id = p_draft_id;

      return jsonb_build_object(
        'status', 'invalid_item',
        'draft_id', p_draft_id,
        'item_id', v_item.id,
        'product_id', v_product.id,
        'product_name', v_product.canonical_name,
        'reason', 'hsn_mismatch'
      );
    end if;
  end loop;

  for v_item in
    select distinct p.id
    from public.document_items i
    join public.stock_product_aliases a
      on a.company_id = v_company.id
     and a.normalized_alias = i.normalized_description
     and a.normalized_unit = regexp_replace(
       upper(i.unit),
       '[^A-Z0-9]',
       '',
       'g'
     )
    join public.stock_products p
      on p.id = a.product_id
     and p.company_id = a.company_id
    where i.draft_id = p_draft_id
    order by p.id
  loop
    perform 1
    from public.stock_products
    where id = v_item.id
    for update;
  end loop;

  select count(*) into v_existing_count
  from public.stock_ledger
  where draft_id = p_draft_id
    and movement_type = 'stock_out';

  if v_existing_count = v_item_count then
    update public.document_drafts
    set
      stock_status = 'applied',
      stock_error = null,
      stock_updated_at = coalesce(stock_updated_at, now())
    where id = p_draft_id;

    return jsonb_build_object(
      'status', 'already_applied',
      'draft_id', p_draft_id,
      'company_id', v_company.id
    );
  elsif v_existing_count <> 0 then
    update public.document_drafts
    set
      stock_status = 'inconsistent',
      stock_error = 'partial_stock_out',
      stock_updated_at = now()
    where id = p_draft_id;

    return jsonb_build_object(
      'status', 'inconsistent',
      'draft_id', p_draft_id,
      'company_id', v_company.id,
      'reason', 'partial_stock_out'
    );
  end if;

  -- Dispatch itself proves that at least the dispatched quantity was available.
  -- Infer only the shortfall so the ledger remains auditable and non-negative.
  for v_item in
    select
      p.id as product_id,
      sum(i.quantity) as required_quantity
    from public.document_items i
    join public.stock_product_aliases a
      on a.company_id = v_company.id
     and a.normalized_alias = i.normalized_description
     and a.normalized_unit = regexp_replace(
       upper(i.unit),
       '[^A-Z0-9]',
       '',
       'g'
     )
    join public.stock_products p
      on p.id = a.product_id
     and p.company_id = a.company_id
    where i.draft_id = p_draft_id
    group by p.id
    order by p.id
  loop
    select coalesce(sum(quantity_delta), 0)
    into v_available
    from public.stock_ledger
    where product_id = v_item.product_id;

    v_required := v_item.required_quantity;

    if v_available < v_required then
      insert into public.stock_ledger (
        product_id,
        draft_id,
        document_item_id,
        movement_type,
        quantity_delta,
        idempotency_key
      )
      values (
        v_item.product_id,
        p_draft_id,
        null,
        'dispatch_inferred',
        v_required - v_available,
        'draft:' || p_draft_id::text || ':product:' ||
          v_item.product_id::text || ':dispatch_inferred:v1'
      )
      on conflict (idempotency_key) do nothing;
    end if;
  end loop;

  insert into public.stock_ledger (
    product_id,
    draft_id,
    document_item_id,
    movement_type,
    quantity_delta,
    idempotency_key
  )
  select
    p.id,
    p_draft_id,
    i.id,
    'stock_out',
    -i.quantity,
    'draft:' || p_draft_id::text || ':item:' || i.id::text || ':stock_out:v2'
  from public.document_items i
  join public.stock_product_aliases a
    on a.company_id = v_company.id
   and a.normalized_alias = i.normalized_description
   and a.normalized_unit = regexp_replace(
     upper(i.unit),
     '[^A-Z0-9]',
     '',
     'g'
   )
  join public.stock_products p
    on p.id = a.product_id
   and p.company_id = a.company_id
  where i.draft_id = p_draft_id
  order by i.line_index, i.id;

  update public.document_drafts
  set
    stock_status = 'applied',
    stock_error = null,
    stock_updated_at = now()
  where id = p_draft_id;

  return jsonb_build_object(
    'status', 'applied',
    'draft_id', p_draft_id,
    'company_id', v_company.id
  );
end;
$function$

;
revoke all on function public.apply_stock_out_for_draft(uuid) from public, anon, authenticated;
grant execute on function public.apply_stock_out_for_draft(uuid) to service_role;

-- Reserve the oldest verified copy of historical bills. No ledger replay occurs.
insert into public.stock_document_claims(identity_key,draft_id)
select distinct on (k) k,id from (
 select d.id,'doc:'||upper(regexp_replace(d.supplier_gstin,'[^A-Za-z0-9]','','g'))||':'||upper(regexp_replace(d.document_number,'[^A-Za-z0-9]','','g')) as k,d.created_at
 from public.document_drafts d where d.parse_status='approved' and d.workflow_status='recorded' and d.verification_status in ('verified','manual_override')
 and nullif(d.supplier_gstin,'') is not null and nullif(d.document_number,'') is not null
) historical order by k,created_at,id on conflict(identity_key) do nothing;
alter table public.delivery_trips add column if not exists company_id uuid references public.stock_companies(id);
-- All mobile bill corrections/cancellation and their audit entry commit together.
create or replace function public.mobile_bill_change(p_draft_id uuid,p_action text,p_item_id uuid,p_quantity numeric,p_value text,p_request_id uuid)
returns jsonb language plpgsql set search_path=public as $$
declare d public.document_drafts%rowtype; r jsonb; previous jsonb; value jsonb; field text;
begin
 select * into d from public.document_drafts where id=p_draft_id for update;
 if not found then raise exception 'Bill unavailable'; end if;
 if exists(select 1 from public.document_actions where action_key=p_request_id and draft_id=p_draft_id) then return jsonb_build_object('status','already_saved'); end if;
 if p_action='cancel' then
  if d.stock_status='applied' then
   r:=public.reverse_stock_for_draft(p_draft_id);
   if r->>'status' not in ('reversed','already_reversed') then raise exception 'Stock could not be restored. Bill kept.'; end if;
  end if;
  previous:=to_jsonb(d.workflow_status); value:=to_jsonb('cancelled'::text); field:='workflow_status';
  update public.document_drafts set workflow_status='cancelled' where id=p_draft_id;
 else
  if d.workflow_status='cancelled' or d.stock_status='duplicate_document' then raise exception 'Use the original active bill'; end if;
  if p_action='quantity' then
   if p_quantity is null or p_quantity<=0 or p_quantity>1000000000 then raise exception 'Enter a valid quantity'; end if;
   select to_jsonb(quantity) into previous from public.document_items where id=p_item_id and draft_id=p_draft_id for update;
   if not found then raise exception 'Product unavailable'; end if;
   field:='item_quantity:'||p_item_id::text; value:=to_jsonb(p_quantity);
   if d.stock_status='applied' then
    r:=public.apply_stock_quantity_correction(p_draft_id,p_item_id,p_quantity,p_request_id);
    if r->>'status' not in ('corrected','already_corrected') then raise exception 'Quantity could not be changed safely'; end if;
   else
    update public.document_items set quantity=p_quantity where id=p_item_id and draft_id=p_draft_id;
   end if;
  elsif p_action='vehicle' then
   if p_value is null or length(p_value)<4 or length(p_value)>20 then raise exception 'Enter a vehicle number'; end if;
   previous:=to_jsonb(d.vehicle_number); value:=to_jsonb(upper(regexp_replace(p_value,'[ -]','','g'))); field:='vehicle_number';
   update public.document_drafts set vehicle_number=upper(regexp_replace(p_value,'[ -]','','g')) where id=p_draft_id;
  elsif p_action='number' then
   if p_value is null or length(btrim(p_value))=0 or length(p_value)>120 then raise exception 'Enter a bill number'; end if;
   previous:=to_jsonb(d.document_number); value:=to_jsonb(btrim(p_value)); field:='document_number';
   update public.document_drafts set document_number=btrim(p_value) where id=p_draft_id;
   if d.workflow_status='recorded' then
    r:=public.claim_stock_document(p_draft_id);
    if r->>'status'<>'claimed' then raise exception 'Bill number conflicts with an existing bill'; end if;
   end if;
  else raise exception 'Unknown action'; end if;
  update public.document_drafts set verification_status='manual_override' where id=p_draft_id;
 end if;
 insert into public.document_actions(draft_id,action,field_key,previous_value,new_value,action_key)
 values(p_draft_id,case when p_action='cancel' then 'cancelled' else 'edit_applied' end,field,previous,value,p_request_id);
 return jsonb_build_object('status','saved');
end $$;
revoke all on function public.mobile_bill_change(uuid,text,uuid,numeric,text,uuid) from public,anon,authenticated;
grant execute on function public.mobile_bill_change(uuid,text,uuid,numeric,text,uuid) to service_role;
-- Attach and close share the same trip row lock, preventing late attachment to a closed trip.
create or replace function public.mobile_attach_trip_bill(p_trip_id uuid,p_message_id uuid)
returns jsonb language plpgsql set search_path=public as $$
declare t public.delivery_trips%rowtype; d public.document_drafts%rowtype;
begin
 select * into t from public.delivery_trips where id=p_trip_id for update;
 if not found or t.status<>'collecting' then raise exception 'This trip is closed'; end if;
 select * into d from public.document_drafts where message_id=p_message_id for update;
 if not found or d.workflow_status='cancelled' then raise exception 'Bill unavailable'; end if;
 if d.stock_status='duplicate_document' then raise exception 'Already uploaded. Use the original bill.'; end if;
 if t.company_id is not null and d.stock_company_id is distinct from t.company_id and not exists(select 1 from public.stock_companies c where c.id=t.company_id and c.gstin=upper(regexp_replace(d.supplier_gstin,'[^A-Za-z0-9]','','g'))) then raise exception 'Bill belongs to another company'; end if;
 if exists(select 1 from public.trip_documents where message_id=p_message_id and trip_id=p_trip_id) then return jsonb_build_object('status','already_attached'); end if;
 if exists(select 1 from public.trip_documents where message_id=p_message_id) then raise exception 'Bill already belongs to a trip'; end if;
 insert into public.trip_documents(trip_id,message_id,draft_id,processing_status) values(p_trip_id,p_message_id,d.id,'parsed');
 return jsonb_build_object('status','attached');
end $$;
create or replace function public.mobile_update_trip(p_trip_id uuid,p_driver_id uuid,p_close boolean)
returns jsonb language plpgsql set search_path=public as $$
declare t public.delivery_trips%rowtype; driver uuid; vehicles text[];
begin
 select * into t from public.delivery_trips where id=p_trip_id for update;
 if not found or t.status='cancelled' then raise exception 'Trip unavailable'; end if;
 driver:=coalesce(p_driver_id,t.driver_id);
 if driver is not null and not exists(select 1 from public.ops_drivers where id=driver and active) then raise exception 'Driver unavailable'; end if;
 perform 1 from public.document_drafts d join public.trip_documents b on b.draft_id=d.id where b.trip_id=p_trip_id order by d.id for update of d;
 select array_agg(distinct upper(d.vehicle_number)) filter(where nullif(d.vehicle_number,'') is not null) into vehicles from public.document_drafts d join public.trip_documents b on b.draft_id=d.id where b.trip_id=p_trip_id and d.stock_status<>'duplicate_document';
 if p_close then
  if driver is null then raise exception 'Choose a driver'; end if;
  if coalesce(cardinality(vehicles),0)>1 then raise exception 'Bills have different vehicles. Use separate trips.'; end if;
  if not exists(select 1 from public.trip_documents where trip_id=p_trip_id) or exists(select 1 from public.trip_documents b left join public.document_drafts d on d.id=b.draft_id where b.trip_id=p_trip_id and (b.processing_status<>'parsed' or d.id is null or (d.stock_status<>'duplicate_document' and (d.workflow_status<>'recorded' or d.stock_status<>'applied')))) then raise exception 'Check the bills before closing this trip'; end if;
 end if;
 update public.delivery_trips set driver_id=driver,vehicle_number=case when cardinality(vehicles)=1 then vehicles[1] else null end,status=case when p_close then 'ready' else status end,finalized_at=case when p_close then coalesce(finalized_at,now()) else finalized_at end,updated_at=now() where id=p_trip_id;
 return jsonb_build_object('status','saved');
end $$;
revoke all on function public.mobile_attach_trip_bill(uuid,uuid) from public,anon,authenticated;
revoke all on function public.mobile_update_trip(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.mobile_attach_trip_bill(uuid,uuid),public.mobile_update_trip(uuid,uuid,boolean) to service_role;
-- Classify old unposted copies, retaining every message, draft, item and trip link.
update public.document_drafts d set stock_status='duplicate_document',stock_error='duplicate_of:'||c.draft_id::text,stock_updated_at=now()
from public.stock_document_claims c
where c.identity_key='doc:'||upper(regexp_replace(d.supplier_gstin,'[^A-Za-z0-9]','','g'))||':'||upper(regexp_replace(d.document_number,'[^A-Za-z0-9]','','g'))
and c.draft_id<>d.id and d.workflow_status<>'cancelled' and not exists(select 1 from public.stock_ledger l where l.draft_id=d.id);

create or replace function public.get_ops_period_summary(p_start timestamptz,p_end timestamptz)
returns table(bill_count bigint,verified_bill_count bigint,review_bill_count bigint,completed_trip_count bigint)
language sql stable set search_path=public as $$
 with bills as (
  select m.received_at,d.workflow_status,d.verification_status,d.stock_status,
   row_number() over(partition by coalesce(case when d.supplier_gstin is not null and d.document_number is not null then upper(regexp_replace(d.supplier_gstin||':'||d.document_number,'[^A-Za-z0-9:]','','g')) end,m.id::text)
   order by exists(select 1 from public.stock_document_claims c where c.draft_id=d.id) desc,(d.workflow_status='recorded') desc,d.created_at,m.received_at) as rank
  from public.whatsapp_messages m left join public.document_drafts d on d.message_id=m.id where m.message_type='document' and (m.mime_type='application/pdf' or lower(coalesce(m.original_filename,'')) like '%.pdf')
 ), stats as (
  select count(*)::bigint as bills,count(*) filter(where workflow_status='recorded' and verification_status in ('verified','manual_override'))::bigint as verified,count(*) filter(where workflow_status='review_required')::bigint as review
  from bills where rank=1 and received_at>=p_start and received_at<p_end and coalesce(workflow_status,'')<>'cancelled' and coalesce(stock_status,'')<>'duplicate_document'
 ) select s.bills,s.verified,s.review,
 (select count(*) from public.delivery_trips t where status='ready' and finalized_at>=p_start and finalized_at<p_end
 and exists(select 1 from public.trip_documents b join public.document_drafts d on d.id=b.draft_id where b.trip_id=t.id and d.stock_status='applied')
 and not exists(select 1 from public.trip_documents b left join public.document_drafts d on d.id=b.draft_id where b.trip_id=t.id and (b.processing_status<>'parsed' or d.id is null or (d.stock_status<>'duplicate_document' and (d.workflow_status<>'recorded' or d.stock_status<>'applied')))))::bigint from stats s;
$$;
revoke all on function public.get_ops_period_summary(timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.get_ops_period_summary(timestamptz,timestamptz) to service_role;
