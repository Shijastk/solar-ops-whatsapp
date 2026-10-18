-- Canonical bootstrap schema for the driver catalog used by the WhatsApp Driver Agent.
-- The live project already has this table; CREATE TABLE IF NOT EXISTS makes this safe
-- for existing deployments while allowing fresh environments to build it reproducibly.
create table if not exists public.ops_drivers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text not null unique,
  active boolean not null default true,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ops_drivers_name_valid check (length(btrim(name)) between 1 and 120),
  constraint ops_drivers_normalized_name_valid check (length(btrim(normalized_name)) between 1 and 120)
);

create index if not exists ops_drivers_active_name_idx
  on public.ops_drivers (name)
  where active = true;

alter table public.ops_drivers enable row level security;
revoke all on public.ops_drivers from public, anon, authenticated;
grant select, insert, update, delete on public.ops_drivers to service_role;
