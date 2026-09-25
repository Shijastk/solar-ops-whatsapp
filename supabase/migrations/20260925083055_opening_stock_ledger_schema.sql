-- One-time Opening Stock master data and immutable outgoing inventory ledger.

alter table public.document_drafts
  add column if not exists stock_status text not null default 'not_ready',
  add column if not exists stock_error text,
  add column if not exists stock_updated_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'document_drafts_stock_status_check'
  ) then
    alter table public.document_drafts
      add constraint document_drafts_stock_status_check
      check (
        stock_status in (
          'not_ready',
          'pending',
          'applied',
          'needs_product_match',
          'company_unmapped',
          'insufficient_stock',
          'invalid_item',
          'inconsistent',
          'reversed'
        )
      );
  end if;
end
$$;

create table if not exists public.stock_companies (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null,
  normalized_name text not null unique,
  gstin text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(btrim(canonical_name)) > 0),
  check (length(btrim(normalized_name)) > 0),
  check (gstin is null or gstin ~ '^[0-9A-Z]{15}$')
);

create unique index if not exists stock_companies_gstin_idx
  on public.stock_companies (gstin)
  where gstin is not null;

create table if not exists public.stock_company_aliases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.stock_companies(id),
  alias_text text not null,
  normalized_alias text not null unique,
  source text not null check (source in ('canonical', 'operator')),
  created_at timestamptz not null default now(),
  check (length(btrim(alias_text)) > 0),
  check (length(btrim(normalized_alias)) > 0)
);

create index if not exists stock_company_aliases_company_idx
  on public.stock_company_aliases (company_id);

create table if not exists public.stock_products (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.stock_companies(id),
  canonical_name text not null,
  normalized_name text not null,
  unit text not null,
  normalized_unit text not null,
  hsn_sac text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(btrim(canonical_name)) > 0),
  check (length(btrim(normalized_name)) > 0),
  check (length(btrim(unit)) > 0),
  check (length(btrim(normalized_unit)) > 0),
  unique (company_id, normalized_name, normalized_unit),
  unique (id, company_id)
);

create index if not exists stock_products_company_active_idx
  on public.stock_products (company_id, active, canonical_name);

create table if not exists public.stock_product_aliases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  product_id uuid not null,
  alias_text text not null,
  normalized_alias text not null,
  normalized_unit text not null,
  source text not null check (source in ('canonical', 'operator')),
  created_at timestamptz not null default now(),
  foreign key (product_id, company_id)
    references public.stock_products(id, company_id),
  check (length(btrim(alias_text)) > 0),
  check (length(btrim(normalized_alias)) > 0),
  check (length(btrim(normalized_unit)) > 0),
  unique (company_id, normalized_alias, normalized_unit)
);

create index if not exists stock_product_aliases_product_idx
  on public.stock_product_aliases (product_id);

create index if not exists stock_product_aliases_product_company_idx
  on public.stock_product_aliases (product_id, company_id);

create table if not exists public.stock_ledger (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.stock_products(id),
  draft_id uuid references public.document_drafts(id),
  document_item_id uuid references public.document_items(id),
  movement_type text not null
    check (movement_type in ('opening', 'stock_out', 'correction', 'reversal')),
  quantity_delta numeric(18,3) not null check (quantity_delta <> 0),
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  check (
    (movement_type = 'opening'
      and draft_id is null
      and document_item_id is null
      and quantity_delta > 0)
    or
    (movement_type <> 'opening' and draft_id is not null)
  )
);

create unique index if not exists stock_ledger_one_opening_per_product_idx
  on public.stock_ledger (product_id)
  where movement_type = 'opening';

create index if not exists stock_ledger_product_created_idx
  on public.stock_ledger (product_id, created_at);

create index if not exists stock_ledger_draft_idx
  on public.stock_ledger (draft_id)
  where draft_id is not null;

create index if not exists stock_ledger_document_item_idx
  on public.stock_ledger (document_item_id)
  where document_item_id is not null;

alter table public.document_drafts
  add column if not exists stock_company_id uuid
    references public.stock_companies(id);

create index if not exists document_drafts_stock_company_idx
  on public.document_drafts (stock_company_id)
  where stock_company_id is not null;

create or replace view public.stock_balances
with (security_invoker = true)
as
select
  p.id as product_id,
  p.company_id,
  c.canonical_name as company_name,
  c.gstin as company_gstin,
  p.canonical_name as product_name,
  p.unit,
  p.hsn_sac,
  coalesce(sum(l.quantity_delta), 0::numeric) as current_quantity
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
  p.hsn_sac;

alter table public.stock_companies enable row level security;
alter table public.stock_company_aliases enable row level security;
alter table public.stock_products enable row level security;
alter table public.stock_product_aliases enable row level security;
alter table public.stock_ledger enable row level security;

revoke all on table public.stock_companies
  from anon, authenticated, service_role;
revoke all on table public.stock_company_aliases
  from anon, authenticated, service_role;
revoke all on table public.stock_products
  from anon, authenticated, service_role;
revoke all on table public.stock_product_aliases
  from anon, authenticated, service_role;
revoke all on table public.stock_ledger
  from anon, authenticated, service_role;
revoke all on table public.stock_balances
  from anon, authenticated, service_role;

grant select, insert, update
  on table public.stock_companies to service_role;
grant select, insert
  on table public.stock_company_aliases to service_role;
grant select, insert, update
  on table public.stock_products to service_role;
grant select, insert
  on table public.stock_product_aliases to service_role;
grant select, insert
  on table public.stock_ledger to service_role;
grant select
  on table public.stock_balances to service_role;

drop trigger if exists set_stock_companies_updated_at
  on public.stock_companies;
create trigger set_stock_companies_updated_at
before update on public.stock_companies
for each row execute function public.set_updated_at();

drop trigger if exists set_stock_products_updated_at
  on public.stock_products;
create trigger set_stock_products_updated_at
before update on public.stock_products
for each row execute function public.set_updated_at();
