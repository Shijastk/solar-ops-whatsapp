-- Require GSTIN for every stock company used by Opening Stock.

alter table public.stock_companies
  alter column gstin set not null;

create or replace function public.create_opening_stock(
  p_company_id uuid,
  p_company_name text,
  p_company_normalized text,
  p_company_gstin text,
  p_product_name text,
  p_product_normalized text,
  p_unit text,
  p_unit_normalized text,
  p_hsn_sac text,
  p_quantity numeric,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_company public.stock_companies%rowtype;
  v_product public.stock_products%rowtype;
begin
  if p_quantity is null or p_quantity <= 0 then
    return jsonb_build_object('status', 'invalid_item', 'reason', 'opening_quantity');
  end if;

  if p_company_id is not null then
    select * into v_company
    from public.stock_companies
    where id = p_company_id and active = true
    for update;

    if not found then
      return jsonb_build_object('status', 'company_unmapped');
    end if;

    if v_company.gstin is null then
      return jsonb_build_object(
        'status', 'inconsistent',
        'reason', 'company_gstin_required'
      );
    end if;

    if p_company_gstin is not null and v_company.gstin <> p_company_gstin then
      return jsonb_build_object(
        'status', 'inconsistent',
        'reason', 'company_gstin_conflict'
      );
    end if;
  else
    if nullif(btrim(p_company_name), '') is null
       or nullif(btrim(p_company_normalized), '') is null then
      return jsonb_build_object('status', 'company_unmapped');
    end if;

    if p_company_gstin is null then
      return jsonb_build_object(
        'status', 'inconsistent',
        'reason', 'company_gstin_required'
      );
    end if;

    select * into v_company
    from public.stock_companies
    where gstin = p_company_gstin
    for update;

    if v_company.id is null then
      select * into v_company
      from public.stock_companies
      where normalized_name = p_company_normalized
      for update;
    end if;

    if v_company.id is null then
      insert into public.stock_companies (
        canonical_name, normalized_name, gstin
      ) values (
        btrim(p_company_name), p_company_normalized, p_company_gstin
      )
      returning * into v_company;

      insert into public.stock_company_aliases (
        company_id, alias_text, normalized_alias, source
      ) values (
        v_company.id, v_company.canonical_name, v_company.normalized_name, 'canonical'
      )
      on conflict (normalized_alias) do nothing;
    elsif v_company.gstin <> p_company_gstin then
      return jsonb_build_object(
        'status', 'inconsistent',
        'reason', 'company_gstin_conflict'
      );
    end if;
  end if;

  insert into public.stock_company_aliases (
    company_id, alias_text, normalized_alias, source
  ) values (
    v_company.id, v_company.canonical_name, v_company.normalized_name, 'canonical'
  )
  on conflict (normalized_alias) do nothing;

  select * into v_product
  from public.stock_products
  where company_id = v_company.id
    and normalized_name = p_product_normalized
    and normalized_unit = p_unit_normalized
  for update;

  if v_product.id is null then
    insert into public.stock_products (
      company_id, canonical_name, normalized_name, unit, normalized_unit, hsn_sac
    ) values (
      v_company.id,
      btrim(p_product_name),
      p_product_normalized,
      btrim(p_unit),
      p_unit_normalized,
      nullif(btrim(p_hsn_sac), '')
    )
    returning * into v_product;

    insert into public.stock_product_aliases (
      company_id, product_id, alias_text, normalized_alias, normalized_unit, source
    ) values (
      v_company.id,
      v_product.id,
      v_product.canonical_name,
      v_product.normalized_name,
      v_product.normalized_unit,
      'canonical'
    );
  elsif
    p_hsn_sac is not null
    and v_product.hsn_sac is not null
    and regexp_replace(upper(v_product.hsn_sac), '[^A-Z0-9]', '', 'g')
        <> regexp_replace(upper(p_hsn_sac), '[^A-Z0-9]', '', 'g')
  then
    return jsonb_build_object(
      'status', 'inconsistent',
      'product_id', v_product.id,
      'reason', 'product_hsn_conflict'
    );
  end if;

  if exists (
    select 1
    from public.stock_ledger
    where product_id = v_product.id
      and movement_type = 'opening'
  ) then
    return jsonb_build_object(
      'status', 'opening_exists',
      'company_id', v_company.id,
      'product_id', v_product.id,
      'product_name', v_product.canonical_name
    );
  end if;

  insert into public.stock_ledger (
    product_id, movement_type, quantity_delta, idempotency_key
  ) values (
    v_product.id,
    'opening',
    p_quantity,
    'opening:' || p_idempotency_key::text
  );

  return jsonb_build_object(
    'status', 'opening_created',
    'company_id', v_company.id,
    'product_id', v_product.id,
    'product_name', v_product.canonical_name
  );
end;
$$;

revoke all on function public.create_opening_stock(
  uuid,text,text,text,text,text,text,text,text,numeric,uuid
) from public, anon, authenticated;

grant execute on function public.create_opening_stock(
  uuid,text,text,text,text,text,text,text,text,numeric,uuid
) to service_role;
