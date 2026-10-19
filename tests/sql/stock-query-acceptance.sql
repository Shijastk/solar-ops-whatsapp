-- Isolated PostgreSQL acceptance for stock balance identity and known-zero semantics.
-- Synthetic fixtures only; always roll back.
begin;

do $test$
declare
  v_key text := replace(gen_random_uuid()::text, '-', '');
  v_company_known uuid := gen_random_uuid();
  v_company_unknown uuid := gen_random_uuid();
  v_product_known uuid := gen_random_uuid();
  v_product_unknown uuid := gen_random_uuid();
  v_known record;
  v_unknown record;
begin
  insert into public.stock_companies
    (id, canonical_name, normalized_name, gstin)
  values
    (v_company_known, 'Synthetic Solar Known', 'synthetic solar known ' || v_key, '32AAAAB1234C1Z5'),
    (v_company_unknown, 'Synthetic Solar Unknown', 'synthetic solar unknown ' || v_key, '33AAAAB1234C1Z4');

  insert into public.stock_products
    (id, company_id, canonical_name, normalized_name, unit, normalized_unit, active)
  values
    (v_product_known, v_company_known, 'Synthetic 560 Wp Panel', 'synthetic 560 wp panel', 'NOS', 'NOS', true),
    (v_product_unknown, v_company_unknown, 'Synthetic 560 Wp Panel', 'synthetic 560 wp panel', 'PCS', 'PCS', true);

  -- A positive opening plus a matching adjustment produces a known zero.
  insert into public.stock_ledger
    (product_id, movement_type, quantity_delta, idempotency_key)
  values
    (v_product_known, 'opening', 5, 'stock-query-opening:' || v_key);

  insert into public.stock_ledger
    (product_id, movement_type, quantity_delta, idempotency_key)
  values
    (v_product_known, 'adjustment', -5, 'stock-query-adjustment:' || v_key);

  select * into v_known
  from public.stock_balances
  where product_id = v_product_known;

  if not found then
    raise exception 'Known product balance row was not returned';
  end if;
  if v_known.company_id <> v_company_known
     or v_known.company_name <> 'Synthetic Solar Known'
     or v_known.product_name <> 'Synthetic 560 Wp Panel'
     or v_known.unit <> 'NOS'
  then
    raise exception 'Known balance resolved to the wrong product/company: %', row_to_json(v_known);
  end if;
  if v_known.balance_known is distinct from true
     or v_known.current_quantity <> 0
  then
    raise exception 'Expected known zero balance, got known=% quantity=%',
      v_known.balance_known, v_known.current_quantity;
  end if;

  select * into v_unknown
  from public.stock_balances
  where product_id = v_product_unknown;

  if not found then
    raise exception 'Unknown product balance row was not returned';
  end if;
  if v_unknown.company_id <> v_company_unknown
     or v_unknown.company_name <> 'Synthetic Solar Unknown'
     or v_unknown.unit <> 'PCS'
  then
    raise exception 'Unknown balance resolved to the wrong product/company: %', row_to_json(v_unknown);
  end if;
  if v_unknown.balance_known is distinct from false
     or v_unknown.current_quantity <> 0
  then
    raise exception 'Expected unknown balance (not known zero), got known=% quantity=%',
      v_unknown.balance_known, v_unknown.current_quantity;
  end if;

  if (select count(*) from public.stock_balances
      where product_name = 'Synthetic 560 Wp Panel'
        and company_id in (v_company_known, v_company_unknown)) <> 2
  then
    raise exception 'Same-name products did not remain isolated by company';
  end if;
end
$test$;

select 'PASS: exact company/product identity, separate same-name catalog entries, known zero vs unknown balance' as result;
rollback;
