-- Company/unit-scoped typo-tolerant candidate lookup for opening-stock duplicate prevention.
-- Read-only helper; stock identity remains decided by deterministic application rules.

create or replace function public.search_opening_stock_product_candidates(
  p_query text,
  p_company_id uuid,
  p_unit text,
  p_limit integer default 12
)
returns table (
  product_id uuid,
  company_id uuid,
  canonical_name text,
  unit text,
  hsn_sac text,
  similarity_score real
)
language sql
stable
security invoker
set search_path = public, extensions
as $function$
  with params as (
    select
      nullif(btrim(p_query), '') as query_text,
      nullif(btrim(p_unit), '') as unit_text,
      greatest(1, least(coalesce(p_limit, 12), 20)) as result_limit
  )
  select
    p.id as product_id,
    p.company_id,
    p.canonical_name,
    p.unit,
    p.hsn_sac,
    (1 - (p.normalized_name <-> params.query_text))::real as similarity_score
  from public.stock_products p
  cross join params
  where p.active = true
    and p.company_id = p_company_id
    and p.normalized_unit = params.unit_text
    and params.query_text is not null
    and params.unit_text is not null
  order by p.normalized_name <-> params.query_text, p.canonical_name
  limit (select result_limit from params);
$function$;

revoke all on function public.search_opening_stock_product_candidates(text, uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.search_opening_stock_product_candidates(text, uuid, text, integer)
  to service_role;
