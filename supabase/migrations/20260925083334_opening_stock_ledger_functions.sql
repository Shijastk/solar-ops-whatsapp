-- Atomic Opening Stock, outgoing Stock OUT, alias mapping, correction, and reversal functions.

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
  v_available numeric;
  v_required numeric;
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
      and gstin = regexp_replace(upper(v_draft.supplier_gstin), '[^A-Z0-9]', '', 'g')
    limit 1;
  end if;

  if v_company.id is null and v_draft.supplier_name is not null then
    v_supplier_normalized := regexp_replace(
      regexp_replace(lower(trim(v_draft.supplier_name)), '[^a-z0-9]+', ' ', 'g'),
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
      and a.normalized_unit = regexp_replace(upper(v_item.unit), '[^A-Z0-9]', '', 'g')
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
     and a.normalized_unit = regexp_replace(upper(i.unit), '[^A-Z0-9]', '', 'g')
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

  for v_item in
    select
      p.id as product_id,
      p.canonical_name as product_name,
      sum(i.quantity) as required_quantity
    from public.document_items i
    join public.stock_product_aliases a
      on a.company_id = v_company.id
     and a.normalized_alias = i.normalized_description
     and a.normalized_unit = regexp_replace(upper(i.unit), '[^A-Z0-9]', '', 'g')
    join public.stock_products p
      on p.id = a.product_id
     and p.company_id = a.company_id
    where i.draft_id = p_draft_id
    group by p.id, p.canonical_name
    order by p.id
  loop
    select coalesce(sum(quantity_delta), 0)
    into v_available
    from public.stock_ledger
    where product_id = v_item.product_id;

    v_required := v_item.required_quantity;

    if v_available < v_required then
      update public.document_drafts
      set
        stock_status = 'insufficient_stock',
        stock_error = 'insufficient_stock',
        stock_updated_at = now()
      where id = p_draft_id;

      return jsonb_build_object(
        'status', 'insufficient_stock',
        'draft_id', p_draft_id,
        'company_id', v_company.id,
        'product_id', v_item.product_id,
        'product_name', v_item.product_name,
        'available', v_available,
        'required', v_required
      );
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
    'draft:' || p_draft_id::text || ':item:' || i.id::text || ':stock_out:v1'
  from public.document_items i
  join public.stock_product_aliases a
    on a.company_id = v_company.id
   and a.normalized_alias = i.normalized_description
   and a.normalized_unit = regexp_replace(upper(i.unit), '[^A-Z0-9]', '', 'g')
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

CREATE OR REPLACE FUNCTION public.apply_stock_quantity_correction(p_draft_id uuid, p_item_id uuid, p_new_quantity numeric, p_action_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
      return jsonb_build_object(
        'status', 'insufficient_stock',
        'draft_id', p_draft_id,
        'item_id', p_item_id,
        'product_id', v_product_id,
        'product_name', v_product_name,
        'available', v_available,
        'required', abs(v_delta)
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

CREATE OR REPLACE FUNCTION public.create_opening_stock(p_company_id uuid, p_company_name text, p_company_normalized text, p_company_gstin text, p_product_name text, p_product_normalized text, p_unit text, p_unit_normalized text, p_hsn_sac text, p_quantity numeric, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
  else
    if nullif(btrim(p_company_name), '') is null
       or nullif(btrim(p_company_normalized), '') is null then
      return jsonb_build_object('status', 'company_unmapped');
    end if;

    if p_company_gstin is not null then
      select * into v_company
      from public.stock_companies
      where gstin = p_company_gstin
      for update;
    end if;

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
    elsif
      p_company_gstin is not null
      and v_company.gstin is not null
      and v_company.gstin <> p_company_gstin
    then
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
$function$;

CREATE OR REPLACE FUNCTION public.map_stock_company_alias(p_draft_id uuid, p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_draft public.document_drafts%rowtype;
  v_company public.stock_companies%rowtype;
  v_normalized text;
  v_existing_company_id uuid;
begin
  select * into v_draft
  from public.document_drafts
  where id = p_draft_id
  for update;

  if not found or nullif(btrim(v_draft.supplier_name), '') is null then
    return jsonb_build_object(
      'status', 'not_ready',
      'draft_id', p_draft_id,
      'reason', 'supplier_name_missing'
    );
  end if;

  select * into v_company
  from public.stock_companies
  where id = p_company_id and active = true;

  if not found then
    return jsonb_build_object(
      'status', 'company_unmapped',
      'draft_id', p_draft_id
    );
  end if;

  if v_draft.supplier_gstin is not null
     and v_company.gstin is not null
     and regexp_replace(upper(v_draft.supplier_gstin), '[^A-Z0-9]', '', 'g')
         <> v_company.gstin
  then
    return jsonb_build_object(
      'status', 'inconsistent',
      'draft_id', p_draft_id,
      'reason', 'company_gstin_mismatch'
    );
  end if;

  v_normalized := regexp_replace(
    regexp_replace(lower(trim(v_draft.supplier_name)), '[^a-z0-9]+', ' ', 'g'),
    '[[:space:]]+',
    ' ',
    'g'
  );

  select company_id into v_existing_company_id
  from public.stock_company_aliases
  where normalized_alias = v_normalized;

  if v_existing_company_id is not null
     and v_existing_company_id <> p_company_id then
    return jsonb_build_object(
      'status', 'company_alias_conflict',
      'draft_id', p_draft_id,
      'company_id', v_existing_company_id
    );
  end if;

  insert into public.stock_company_aliases (
    company_id,
    alias_text,
    normalized_alias,
    source
  )
  values (
    p_company_id,
    v_draft.supplier_name,
    v_normalized,
    'operator'
  )
  on conflict (normalized_alias) do nothing;

  update public.document_drafts
  set
    stock_company_id = p_company_id,
    stock_error = null,
    stock_updated_at = now()
  where id = p_draft_id;

  return jsonb_build_object(
    'status',
    case
      when v_existing_company_id = p_company_id then 'company_alias_exists'
      else 'company_alias_saved'
    end,
    'draft_id', p_draft_id,
    'company_id', p_company_id
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.map_stock_product_alias(p_draft_id uuid, p_item_id uuid, p_product_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_draft public.document_drafts%rowtype;
  v_company public.stock_companies%rowtype;
  v_item public.document_items%rowtype;
  v_product public.stock_products%rowtype;
  v_existing_product_id uuid;
  v_unit text;
  v_supplier_normalized text;
begin
  select * into v_draft
  from public.document_drafts
  where id = p_draft_id;

  if not found then
    return jsonb_build_object('status', 'not_ready', 'draft_id', p_draft_id);
  end if;

  select * into v_item
  from public.document_items
  where id = p_item_id and draft_id = p_draft_id;

  if not found then
    return jsonb_build_object(
      'status', 'invalid_item',
      'draft_id', p_draft_id,
      'item_id', p_item_id,
      'reason', 'item_not_found'
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
      and gstin = regexp_replace(upper(v_draft.supplier_gstin), '[^A-Z0-9]', '', 'g')
    limit 1;
  end if;

  if v_company.id is null and v_draft.supplier_name is not null then
    v_supplier_normalized := regexp_replace(
      regexp_replace(lower(trim(v_draft.supplier_name)), '[^a-z0-9]+', ' ', 'g'),
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
    return jsonb_build_object(
      'status', 'company_unmapped',
      'draft_id', p_draft_id
    );
  end if;

  update public.document_drafts
  set stock_company_id = v_company.id
  where id = p_draft_id
    and stock_company_id is null;

  select * into v_product
  from public.stock_products
  where id = p_product_id
    and company_id = v_company.id
    and active = true;

  if not found then
    return jsonb_build_object(
      'status', 'inconsistent',
      'draft_id', p_draft_id,
      'reason', 'product_company_mismatch'
    );
  end if;

  v_unit := regexp_replace(upper(coalesce(v_item.unit, '')), '[^A-Z0-9]', '', 'g');

  if v_unit = '' or v_unit <> v_product.normalized_unit then
    return jsonb_build_object(
      'status', 'inconsistent',
      'draft_id', p_draft_id,
      'reason', 'product_unit_mismatch'
    );
  end if;

  if v_item.hsn_sac is not null
     and v_product.hsn_sac is not null
     and regexp_replace(upper(v_item.hsn_sac), '[^A-Z0-9]', '', 'g')
         <> regexp_replace(upper(v_product.hsn_sac), '[^A-Z0-9]', '', 'g')
  then
    return jsonb_build_object(
      'status', 'inconsistent',
      'draft_id', p_draft_id,
      'reason', 'product_hsn_mismatch'
    );
  end if;

  select product_id into v_existing_product_id
  from public.stock_product_aliases
  where company_id = v_company.id
    and normalized_alias = v_item.normalized_description
    and normalized_unit = v_unit;

  if v_existing_product_id is not null then
    if v_existing_product_id = p_product_id then
      return jsonb_build_object(
        'status', 'alias_exists',
        'draft_id', p_draft_id,
        'company_id', v_company.id,
        'item_id', p_item_id,
        'product_id', p_product_id
      );
    end if;

    return jsonb_build_object(
      'status', 'alias_conflict',
      'draft_id', p_draft_id,
      'company_id', v_company.id,
      'item_id', p_item_id,
      'product_id', v_existing_product_id
    );
  end if;

  insert into public.stock_product_aliases (
    company_id,
    product_id,
    alias_text,
    normalized_alias,
    normalized_unit,
    source
  )
  values (
    v_company.id,
    p_product_id,
    v_item.description,
    v_item.normalized_description,
    v_unit,
    'operator'
  );

  return jsonb_build_object(
    'status', 'alias_saved',
    'draft_id', p_draft_id,
    'company_id', v_company.id,
    'item_id', p_item_id,
    'product_id', p_product_id,
    'product_name', v_product.canonical_name
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.reverse_stock_for_draft(p_draft_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_draft public.document_drafts%rowtype;
  v_row record;
  v_has_net boolean := false;
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

  for v_row in
    select product_id, sum(quantity_delta) as net_delta
    from public.stock_ledger
    where draft_id = p_draft_id
    group by product_id
    order by product_id
  loop
    if v_row.net_delta < 0 then
      v_has_net := true;

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
        null,
        'reversal',
        -v_row.net_delta,
        'draft:' || p_draft_id::text || ':product:' ||
          v_row.product_id::text || ':reversal:v1'
      )
      on conflict (idempotency_key) do nothing;
    elsif v_row.net_delta > 0 then
      update public.document_drafts
      set
        stock_status = 'inconsistent',
        stock_error = 'positive_document_net',
        stock_updated_at = now()
      where id = p_draft_id;

      return jsonb_build_object(
        'status', 'inconsistent',
        'draft_id', p_draft_id,
        'reason', 'positive_document_net'
      );
    end if;
  end loop;

  update public.document_drafts
  set
    stock_status = 'reversed',
    stock_error = null,
    stock_updated_at = now()
  where id = p_draft_id;

  return jsonb_build_object(
    'status',
    case when v_has_net then 'reversed' else 'already_reversed' end,
    'draft_id',
    p_draft_id
  );
end;
$function$;

revoke all on function public.create_opening_stock(uuid,text,text,text,text,text,text,text,text,numeric,uuid)
  from public, anon, authenticated;
revoke all on function public.apply_stock_out_for_draft(uuid)
  from public, anon, authenticated;
revoke all on function public.map_stock_company_alias(uuid,uuid)
  from public, anon, authenticated;
revoke all on function public.map_stock_product_alias(uuid,uuid,uuid)
  from public, anon, authenticated;
revoke all on function public.apply_stock_quantity_correction(uuid,uuid,numeric,uuid)
  from public, anon, authenticated;
revoke all on function public.reverse_stock_for_draft(uuid)
  from public, anon, authenticated;

grant execute on function public.create_opening_stock(uuid,text,text,text,text,text,text,text,text,numeric,uuid)
  to service_role;
grant execute on function public.apply_stock_out_for_draft(uuid)
  to service_role;
grant execute on function public.map_stock_company_alias(uuid,uuid)
  to service_role;
grant execute on function public.map_stock_product_alias(uuid,uuid,uuid)
  to service_role;
grant execute on function public.apply_stock_quantity_correction(uuid,uuid,numeric,uuid)
  to service_role;
grant execute on function public.reverse_stock_for_draft(uuid)
  to service_role;
