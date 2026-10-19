-- Ledger-first inventory: outgoing events are recorded even before positive stock exists.
-- Stock IN is a positive audited movement; balances may be negative until stock is entered.

alter table public.stock_product_aliases
  drop constraint if exists stock_product_aliases_source_check;

alter table public.stock_product_aliases
  add constraint stock_product_aliases_source_check
  check (source in ('canonical', 'operator', 'document'));

alter table public.stock_ledger
  drop constraint if exists stock_ledger_movement_type_check;

alter table public.stock_ledger
  add constraint stock_ledger_movement_type_check
  check (
    movement_type in (
      'opening',
      'stock_in',
      'stock_out',
      'correction',
      'reversal',
      'adjustment'
    )
  );

alter table public.stock_ledger
  drop constraint if exists stock_ledger_check;

alter table public.stock_ledger
  add constraint stock_ledger_check
  check (
    (
      movement_type in ('opening', 'stock_in')
      and draft_id is null
      and document_item_id is null
      and quantity_delta > 0
    )
    or
    (
      movement_type = 'adjustment'
      and draft_id is null
      and document_item_id is null
    )
    or
    (
      movement_type in ('stock_out', 'correction', 'reversal')
      and draft_id is not null
    )
  );

create index if not exists stock_ledger_created_idx
  on public.stock_ledger (created_at desc, id);

create or replace function public.record_stock_in(
  p_product_id uuid,
  p_quantity numeric,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $function$
declare
  v_product public.stock_products%rowtype;
  v_key text;
  v_current numeric;
begin
  if p_quantity is null or p_quantity <= 0 or p_quantity > 1000000000 then
    return jsonb_build_object(
      'status', 'invalid_item',
      'product_id', p_product_id,
      'reason', 'stock_in_quantity'
    );
  end if;

  v_key := 'stock_in:' || p_idempotency_key::text;

  if exists (
    select 1 from public.stock_ledger where idempotency_key = v_key
  ) then
    return jsonb_build_object(
      'status', 'stock_in_already_applied',
      'product_id', p_product_id
    );
  end if;

  select * into v_product
  from public.stock_products
  where id = p_product_id and active = true
  for update;

  if not found then
    return jsonb_build_object(
      'status', 'not_ready',
      'product_id', p_product_id
    );
  end if;

  insert into public.stock_ledger (
    product_id,
    draft_id,
    document_item_id,
    movement_type,
    quantity_delta,
    idempotency_key
  )
  values (
    p_product_id,
    null,
    null,
    'stock_in',
    p_quantity,
    v_key
  );

  select coalesce(sum(quantity_delta), 0)
  into v_current
  from public.stock_ledger
  where product_id = p_product_id;

  return jsonb_build_object(
    'status', 'stock_in_applied',
    'product_id', p_product_id,
    'product_name', v_product.canonical_name,
    'current_quantity', v_current
  );
end;
$function$;

revoke all on function public.record_stock_in(uuid,numeric,uuid)
  from public, anon, authenticated;
grant execute on function public.record_stock_in(uuid,numeric,uuid)
  to service_role;

create or replace function public.apply_stock_out_for_draft(p_draft_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $function$
declare
  v_draft public.document_drafts%rowtype;
  v_company public.stock_companies%rowtype;
  v_item record;
  v_product public.stock_products%rowtype;
  v_item_count integer;
  v_existing_count integer;
  v_supplier_normalized text;
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
$function$;

create or replace function public.adjust_stock_balance(
  p_product_id uuid,
  p_target_quantity numeric,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $function$
declare
  v_product public.stock_products%rowtype;
  v_current numeric;
  v_delta numeric;
  v_key text;
begin
  if p_target_quantity is null
     or p_target_quantity < 0
     or p_target_quantity > 1000000000 then
    return jsonb_build_object(
      'status', 'not_ready',
      'product_id', p_product_id
    );
  end if;

  v_key := 'adjust:' || p_idempotency_key::text;

  if exists (
    select 1
    from public.stock_ledger
    where idempotency_key = v_key
  ) then
    return jsonb_build_object(
      'status', 'already_adjusted',
      'product_id', p_product_id,
      'target_quantity', p_target_quantity
    );
  end if;

  select * into v_product
  from public.stock_products
  where id = p_product_id and active = true
  for update;

  if not found then
    return jsonb_build_object(
      'status', 'not_ready',
      'product_id', p_product_id
    );
  end if;

  select coalesce(sum(quantity_delta), 0)
  into v_current
  from public.stock_ledger
  where product_id = p_product_id;

  v_delta := p_target_quantity - v_current;

  if v_delta = 0 then
    return jsonb_build_object(
      'status', 'no_change',
      'product_id', p_product_id,
      'product_name', v_product.canonical_name,
      'previous_quantity', v_current,
      'target_quantity', p_target_quantity
    );
  end if;

  insert into public.stock_ledger (
    product_id,
    draft_id,
    document_item_id,
    movement_type,
    quantity_delta,
    idempotency_key
  )
  values (
    p_product_id,
    null,
    null,
    'adjustment',
    v_delta,
    v_key
  );

  return jsonb_build_object(
    'status', 'adjusted',
    'product_id', p_product_id,
    'product_name', v_product.canonical_name,
    'previous_quantity', v_current,
    'target_quantity', p_target_quantity
  );
end;
$function$;

revoke all on function public.adjust_stock_balance(uuid,numeric,uuid)
  from public, anon, authenticated;
grant execute on function public.adjust_stock_balance(uuid,numeric,uuid)
  to service_role;

create or replace view public.stock_history
with (security_invoker = true)
as
select
  l.id,
  l.product_id,
  p.company_id,
  c.canonical_name as company_name,
  c.gstin as company_gstin,
  p.canonical_name as product_name,
  p.unit,
  p.hsn_sac,
  l.movement_type,
  l.quantity_delta,
  l.created_at,
  l.draft_id,
  d.document_number,
  d.document_date,
  sum(l.quantity_delta) over (
    partition by l.product_id
    order by l.created_at, l.id
    rows between unbounded preceding and current row
  ) as balance_after
from public.stock_ledger l
join public.stock_products p on p.id = l.product_id
join public.stock_companies c on c.id = p.company_id
left join public.document_drafts d on d.id = l.draft_id;

revoke all on table public.stock_history
  from public, anon, authenticated, service_role;
grant select on table public.stock_history to service_role;
