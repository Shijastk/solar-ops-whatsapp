-- Dispatch-proven inventory:
-- A completed outgoing bill proves that at least the dispatched quantity existed.
-- If the ledger balance is below the outgoing quantity, infer only the shortfall
-- immediately before the outgoing movement so the resulting balance never goes negative.

alter table public.stock_ledger
  drop constraint if exists stock_ledger_movement_type_check;

alter table public.stock_ledger
  add constraint stock_ledger_movement_type_check
  check (
    movement_type in (
      'opening',
      'stock_in',
      'dispatch_inferred',
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
      movement_type = 'dispatch_inferred'
      and draft_id is not null
      and document_item_id is null
      and quantity_delta > 0
    )
    or
    (
      movement_type in ('stock_out', 'correction', 'reversal')
      and draft_id is not null
    )
  );

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
  v_available numeric;
  v_required numeric;
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
$function$;

revoke all on function public.apply_stock_out_for_draft(uuid)
  from public, anon, authenticated;
grant execute on function public.apply_stock_out_for_draft(uuid)
  to service_role;

create or replace function public.apply_stock_quantity_correction(
  p_draft_id uuid,
  p_item_id uuid,
  p_new_quantity numeric,
  p_action_key uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $function$
declare
  v_draft public.document_drafts%rowtype;
  v_item public.document_items%rowtype;
  v_product_id uuid;
  v_product_name text;
  v_old_quantity numeric;
  v_delta numeric;
  v_available numeric;
  v_key text;
begin
  if p_new_quantity is null or p_new_quantity <= 0 then
    return jsonb_build_object(
      'status', 'invalid_item',
      'draft_id', p_draft_id,
      'item_id', p_item_id,
      'reason', 'invalid_quantity'
    );
  end if;

  v_key := 'edit:' || p_action_key::text;

  if exists (
    select 1 from public.stock_ledger where idempotency_key = v_key
  ) then
    return jsonb_build_object(
      'status', 'already_corrected',
      'draft_id', p_draft_id,
      'item_id', p_item_id
    );
  end if;

  select * into v_draft
  from public.document_drafts
  where id = p_draft_id
  for update;

  if not found
     or v_draft.workflow_status <> 'recorded'
     or v_draft.stock_status <> 'applied' then
    return jsonb_build_object(
      'status', 'not_ready',
      'draft_id', p_draft_id,
      'item_id', p_item_id
    );
  end if;

  select * into v_item
  from public.document_items
  where id = p_item_id and draft_id = p_draft_id
  for update;

  if not found or v_item.quantity is null or v_item.quantity <= 0 then
    return jsonb_build_object(
      'status', 'invalid_item',
      'draft_id', p_draft_id,
      'item_id', p_item_id,
      'reason', 'item_not_found_or_quantity'
    );
  end if;

  select l.product_id, p.canonical_name
  into v_product_id, v_product_name
  from public.stock_ledger l
  join public.stock_products p on p.id = l.product_id
  where l.draft_id = p_draft_id
    and l.document_item_id = p_item_id
    and l.movement_type = 'stock_out'
  limit 1;

  if v_product_id is null then
    return jsonb_build_object(
      'status', 'inconsistent',
      'draft_id', p_draft_id,
      'item_id', p_item_id,
      'reason', 'missing_stock_out'
    );
  end if;

  perform 1
  from public.stock_products
  where id = v_product_id
  for update;

  v_old_quantity := v_item.quantity;
  v_delta := v_old_quantity - p_new_quantity;

  if v_delta < 0 then
    select coalesce(sum(quantity_delta), 0)
    into v_available
    from public.stock_ledger
    where product_id = v_product_id;

    if v_available < abs(v_delta) then
      insert into public.stock_ledger (
        product_id,
        draft_id,
        document_item_id,
        movement_type,
        quantity_delta,
        idempotency_key
      )
      values (
        v_product_id,
        p_draft_id,
        null,
        'dispatch_inferred',
        abs(v_delta) - v_available,
        'edit:' || p_action_key::text || ':dispatch_inferred'
      );
    end if;
  end if;

  if v_delta <> 0 then
    insert into public.stock_ledger (
      product_id,
      draft_id,
      document_item_id,
      movement_type,
      quantity_delta,
      idempotency_key
    )
    values (
      v_product_id,
      p_draft_id,
      p_item_id,
      'correction',
      v_delta,
      v_key
    );
  end if;

  update public.document_items
  set quantity = p_new_quantity
  where id = p_item_id;

  update public.document_drafts
  set
    stock_updated_at = now(),
    stock_error = null
  where id = p_draft_id;

  return jsonb_build_object(
    'status', 'corrected',
    'draft_id', p_draft_id,
    'item_id', p_item_id,
    'product_id', v_product_id,
    'product_name', v_product_name
  );
end;
$function$;

revoke all on function public.apply_stock_quantity_correction(uuid,uuid,numeric,uuid)
  from public, anon, authenticated;
grant execute on function public.apply_stock_quantity_correction(uuid,uuid,numeric,uuid)
  to service_role;

create or replace function public.reverse_stock_for_draft(p_draft_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $function$
declare
  v_draft public.document_drafts%rowtype;
  v_row record;
  v_has_movement boolean := false;
begin
  select * into v_draft
  from public.document_drafts
  where id = p_draft_id
  for update;

  if not found then
    return jsonb_build_object('status', 'not_ready', 'draft_id', p_draft_id);
  end if;

  if v_draft.stock_status = 'reversed' then
    return jsonb_build_object(
      'status', 'already_reversed',
      'draft_id', p_draft_id
    );
  end if;

  if v_draft.stock_status <> 'applied' then
    return jsonb_build_object(
      'status', 'not_ready',
      'draft_id', p_draft_id
    );
  end if;

  -- Negate every immutable movement created by this draft. This also reverses
  -- dispatch-inferred availability, so cancelling a bill does not fabricate stock.
  for v_row in
    select id, product_id, document_item_id, quantity_delta
    from public.stock_ledger
    where draft_id = p_draft_id
      and movement_type <> 'reversal'
    order by created_at, id
  loop
    v_has_movement := true;

    perform 1
    from public.stock_products
    where id = v_row.product_id
    for update;

    insert into public.stock_ledger (
      product_id,
      draft_id,
      document_item_id,
      movement_type,
      quantity_delta,
      idempotency_key
    )
    values (
      v_row.product_id,
      p_draft_id,
      v_row.document_item_id,
      'reversal',
      -v_row.quantity_delta,
      'draft:' || p_draft_id::text || ':source:' ||
        v_row.id::text || ':reversal:v2'
    )
    on conflict (idempotency_key) do nothing;
  end loop;

  update public.document_drafts
  set
    stock_status = 'reversed',
    stock_error = null,
    stock_updated_at = now()
  where id = p_draft_id;

  return jsonb_build_object(
    'status',
    case when v_has_movement then 'reversed' else 'already_reversed' end,
    'draft_id',
    p_draft_id
  );
end;
$function$;

revoke all on function public.reverse_stock_for_draft(uuid)
  from public, anon, authenticated;
grant execute on function public.reverse_stock_for_draft(uuid)
  to service_role;

create or replace view public.stock_balances
with (security_invoker = true)
as
with totals as (
  select
    p.id as product_id,
    p.company_id,
    c.canonical_name as company_name,
    c.gstin as company_gstin,
    p.canonical_name as product_name,
    p.unit,
    p.hsn_sac,
    coalesce(sum(l.quantity_delta), 0::numeric) as raw_quantity,
    coalesce(
      bool_or(
        l.movement_type in (
          'opening',
          'stock_in',
          'adjustment',
          'dispatch_inferred'
        )
      ),
      false
    ) as balance_known
  from public.stock_products p
  join public.stock_companies c on c.id = p.company_id
  left join public.stock_ledger l on l.product_id = p.id
  where p.active = true
  group by
    p.id,
    p.company_id,
    c.canonical_name,
    c.gstin,
    p.canonical_name,
    p.unit,
    p.hsn_sac
)
select
  product_id,
  company_id,
  company_name,
  company_gstin,
  product_name,
  unit,
  hsn_sac,
  greatest(raw_quantity, 0::numeric) as current_quantity,
  balance_known
from totals;

revoke all on table public.stock_balances
  from public, anon, authenticated, service_role;
grant select on table public.stock_balances to service_role;

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
  case
    when count(*) filter (
      where l.movement_type in (
        'opening',
        'stock_in',
        'adjustment',
        'dispatch_inferred'
      )
    ) over (
      partition by l.product_id
      order by l.created_at, l.id
      rows between unbounded preceding and current row
    ) > 0
    then greatest(
      sum(l.quantity_delta) over (
        partition by l.product_id
        order by l.created_at, l.id
        rows between unbounded preceding and current row
      ),
      0::numeric
    )
    else null
  end as balance_after
from public.stock_ledger l
join public.stock_products p on p.id = l.product_id
join public.stock_companies c on c.id = p.company_id
left join public.document_drafts d on d.id = l.draft_id;

revoke all on table public.stock_history
  from public, anon, authenticated, service_role;
grant select on table public.stock_history to service_role;
