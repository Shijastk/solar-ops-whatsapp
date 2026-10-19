-- Indexed typo-tolerant product lookup for read-only WhatsApp stock questions.
-- This does not create aliases or mutate stock identity.

create extension if not exists pg_trgm with schema extensions;

create index if not exists stock_products_normalized_name_trgm_gist_idx
  on public.stock_products
  using gist (normalized_name extensions.gist_trgm_ops)
  where active = true;

create index if not exists stock_product_aliases_normalized_alias_trgm_gist_idx
  on public.stock_product_aliases
  using gist (normalized_alias extensions.gist_trgm_ops);

create or replace function public.search_stock_product_candidates(
  p_query text,
  p_limit integer default 8
)
returns table (
  product_id uuid,
  matched_name text,
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
      greatest(1, least(coalesce(p_limit, 8), 12)) as result_limit
  ),
  canonical as (
    select
      p.id as product_id,
      p.normalized_name as matched_name,
      (1 - (p.normalized_name <-> params.query_text))::real as similarity_score
    from public.stock_products p
    cross join params
    where p.active = true
      and params.query_text is not null
    order by p.normalized_name <-> params.query_text
    limit (select result_limit from params)
  ),
  aliases as (
    select
      a.product_id,
      a.normalized_alias as matched_name,
      (1 - (a.normalized_alias <-> params.query_text))::real as similarity_score
    from public.stock_product_aliases a
    join public.stock_products p on p.id = a.product_id and p.active = true
    cross join params
    where params.query_text is not null
    order by a.normalized_alias <-> params.query_text
    limit (select result_limit from params)
  ),
  ranked as (
    select
      combined.product_id,
      combined.matched_name,
      combined.similarity_score,
      row_number() over (
        partition by combined.product_id
        order by combined.similarity_score desc, combined.matched_name
      ) as product_rank
    from (
      select * from canonical
      union all
      select * from aliases
    ) combined
  )
  select
    ranked.product_id,
    ranked.matched_name,
    ranked.similarity_score
  from ranked
  cross join params
  where ranked.product_rank = 1
  order by ranked.similarity_score desc, ranked.matched_name
  limit (select result_limit from params);
$function$;

revoke all on function public.search_stock_product_candidates(text, integer)
  from public, anon, authenticated;
grant execute on function public.search_stock_product_candidates(text, integer)
  to service_role;
