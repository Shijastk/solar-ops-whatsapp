-- Serialize stock receipts on the product row before checking the idempotency key.
-- The unique ledger key already prevents duplicate quantity, but checking the key
-- before acquiring this lock lets concurrent retries surface as unique-key errors
-- instead of returning the documented idempotent status.

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

  -- Recheck only after the product lock: concurrent calls with the same key
  -- serialize here, so the second call sees the first committed ledger entry.
  if exists (
    select 1 from public.stock_ledger where idempotency_key = v_key
  ) then
    return jsonb_build_object(
      'status', 'stock_in_already_applied',
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
