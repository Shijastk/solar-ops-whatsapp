-- Allow audited manual current-stock adjustments without rewriting opening or bill history.

alter table public.stock_ledger
  drop constraint if exists stock_ledger_movement_type_check;

alter table public.stock_ledger
  add constraint stock_ledger_movement_type_check
  check (
    movement_type in (
      'opening',
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
      movement_type = 'opening'
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

create or replace function public.adjust_stock_balance(
  p_product_id uuid,
  p_target_quantity numeric,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
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
  where id = p_product_id
    and active = true
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

  if v_current < 0 then
    return jsonb_build_object(
      'status', 'inconsistent',
      'product_id', p_product_id,
      'product_name', v_product.canonical_name,
      'previous_quantity', v_current,
      'target_quantity', p_target_quantity
    );
  end if;

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
$$;

revoke all on function public.adjust_stock_balance(uuid,numeric,uuid)
  from public, anon, authenticated;

grant execute on function public.adjust_stock_balance(uuid,numeric,uuid)
  to service_role;
