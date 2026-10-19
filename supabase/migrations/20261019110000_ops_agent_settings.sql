create table if not exists public.ops_agent_settings (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.ops_agent_settings enable row level security;
revoke all on public.ops_agent_settings from public, anon, authenticated;
grant select, insert, update on public.ops_agent_settings to service_role;

insert into public.ops_agent_settings (singleton, enabled)
values (true, false)
on conflict (singleton) do nothing;
