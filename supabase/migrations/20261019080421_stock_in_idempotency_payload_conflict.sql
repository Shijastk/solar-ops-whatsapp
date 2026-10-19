-- Reject a stock receipt idempotency key reused with a different payload.
-- The key lock serializes retries across product rows; the product row lock
-- serializes independent receipts for the same product.
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
  v_existing_product_id uuid;
  v_existing_quantity numeric;
  v_existing_movement_type text;
begin
  if p_quantity is null or p_quantity <= 0 or p_quantity > 1000000000 then
    return jsonb_build_object('status','invalid_item','product_id',p_product_id,'reason','stock_in_quantity');
  end if;

  if p_idempotency_key is null then
    return jsonb_build_object(
      'status','invalid_item',
      'product_id',p_product_id,
      'reason','stock_in_idempotency_key'
    );
  end if;

  v_key := 'stock_in:' || p_idempotency_key::text;
  perform pg_advisory_xact_lock(hashtextextended(v_key, 0));

  select * into v_product
  from public.stock_products
  where id = p_product_id and active = true
  for update;

  if not found then
    return jsonb_build_object('status','not_ready','product_id',p_product_id);
  end if;

  select product_id, quantity_delta, movement_type
  into v_existing_product_id, v_existing_quantity, v_existing_movement_type
  from public.stock_ledger
  where idempotency_key = v_key;

  if found then
    if v_existing_product_id <> p_product_id
      or v_existing_quantity <> p_quantity
      or v_existing_movement_type <> 'stock_in'
    then
      return jsonb_build_object(
        'status','idempotency_conflict',
        'product_id',p_product_id,
        'reason','stock_in_key_reused_with_different_payload'
      );
    end if;

    return jsonb_build_object('status','stock_in_already_applied','product_id',p_product_id);
  end if;

  insert into public.stock_ledger(
    product_id,draft_id,document_item_id,movement_type,quantity_delta,idempotency_key
  )
  values(p_product_id,null,null,'stock_in',p_quantity,v_key);

  select coalesce(sum(quantity_delta),0)
  into v_current
  from public.stock_ledger
  where product_id = p_product_id;

  return jsonb_build_object(
    'status','stock_in_applied',
    'product_id',p_product_id,
    'product_name',v_product.canonical_name,
    'current_quantity',v_current
  );
end;
$function$;
