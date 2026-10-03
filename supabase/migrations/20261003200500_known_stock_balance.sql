-- Keep outgoing history immutable without exposing a negative current stock
-- before an operator has supplied a physical/current stock count.

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
      bool_or(l.movement_type in ('opening', 'stock_in', 'adjustment')),
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
  case when balance_known then raw_quantity else 0::numeric end as current_quantity,
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
      where l2.movement_type in ('opening', 'stock_in', 'adjustment')
    ) over (
      partition by l.product_id
      order by l.created_at, l.id
      rows between unbounded preceding and current row
    ) > 0
    then sum(l.quantity_delta) over (
      partition by l.product_id
      order by l.created_at, l.id
      rows between unbounded preceding and current row
    )
    else null
  end as balance_after
from public.stock_ledger l
join public.stock_products p on p.id = l.product_id
join public.stock_companies c on c.id = p.company_id
left join public.document_drafts d on d.id = l.draft_id
left join public.stock_ledger l2 on l2.id = l.id;

revoke all on table public.stock_history
  from public, anon, authenticated, service_role;
grant select on table public.stock_history to service_role;
