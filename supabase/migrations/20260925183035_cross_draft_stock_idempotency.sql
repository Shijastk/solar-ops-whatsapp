-- Cross-draft stock idempotency for repeated uploads of the same business document.
CREATE TABLE IF NOT EXISTS public.stock_document_claims (
  identity_key text PRIMARY KEY,
  draft_id uuid NOT NULL UNIQUE REFERENCES public.document_drafts(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_document_claims_identity_nonempty CHECK (length(btrim(identity_key)) > 0)
);

ALTER TABLE public.stock_document_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.stock_document_claims FROM anon, authenticated;

INSERT INTO public.stock_document_claims (identity_key, draft_id)
SELECT DISTINCT ON (identity_key) identity_key, draft_id
FROM (
  SELECT d.id AS draft_id,
    CASE
      WHEN nullif(regexp_replace(coalesce(d.eway_bill_number, ''), '[^A-Za-z0-9]', '', 'g'), '') IS NOT NULL
        THEN 'eway:' || upper(regexp_replace(d.eway_bill_number, '[^A-Za-z0-9]', '', 'g'))
      WHEN nullif(regexp_replace(coalesce(d.supplier_gstin, ''), '[^A-Za-z0-9]', '', 'g'), '') IS NOT NULL
        AND nullif(regexp_replace(coalesce(d.document_number, ''), '[^A-Za-z0-9]', '', 'g'), '') IS NOT NULL
        THEN 'doc:' || upper(regexp_replace(d.supplier_gstin, '[^A-Za-z0-9]', '', 'g')) || ':' ||
          upper(regexp_replace(d.document_number, '[^A-Za-z0-9]', '', 'g'))
      ELSE NULL
    END AS identity_key,
    min(l.created_at) OVER (PARTITION BY d.id) AS first_movement_at
  FROM public.document_drafts d
  JOIN public.stock_ledger l ON l.draft_id = d.id AND l.movement_type = 'stock_out'
) applied
WHERE identity_key IS NOT NULL
ORDER BY identity_key, first_movement_at, draft_id
ON CONFLICT (identity_key) DO NOTHING;

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
  v_document_identity text;
  v_claimed_draft_id uuid;
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

  v_document_identity := case
    when nullif(regexp_replace(coalesce(v_draft.eway_bill_number, ''), '[^A-Za-z0-9]', '', 'g'), '') is not null
      then 'eway:' || upper(regexp_replace(v_draft.eway_bill_number, '[^A-Za-z0-9]', '', 'g'))
    when nullif(regexp_replace(coalesce(v_draft.supplier_gstin, ''), '[^A-Za-z0-9]', '', 'g'), '') is not null
      and nullif(regexp_replace(coalesce(v_draft.document_number, ''), '[^A-Za-z0-9]', '', 'g'), '') is not null
      then 'doc:' || upper(regexp_replace(v_draft.supplier_gstin, '[^A-Za-z0-9]', '', 'g')) || ':' ||
        upper(regexp_replace(v_draft.document_number, '[^A-Za-z0-9]', '', 'g'))
    else null
  end;

  if v_document_identity is not null then
    insert into public.stock_document_claims (identity_key, draft_id)
    values (v_document_identity, p_draft_id)
    on conflict (identity_key) do nothing;

    select draft_id into v_claimed_draft_id
    from public.stock_document_claims
    where identity_key = v_document_identity;

    if v_claimed_draft_id is distinct from p_draft_id then
      update public.document_drafts
      set stock_status = 'duplicate_document', stock_error = 'duplicate_document', stock_updated_at = now()
      where id = p_draft_id;

      return jsonb_build_object(
        'status', 'duplicate_document',
        'draft_id', p_draft_id,
        'reason', 'document_identity_already_applied'
      );
    end if;
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
