create table if not exists public.ops_agent_conversation_context (
  sender_phone text not null check (length(sender_phone) between 5 and 32),
  business_scope text not null default 'solar-ops'
    check (length(business_scope) between 1 and 64),
  last_intent text not null check (
    last_intent in (
      'driver_count',
      'driver_list',
      'stock_balance',
      'stock_inventory_summary',
      'today_bill_count',
      'pending_bill_count',
      'latest_bill',
      'today_trip_summary',
      'yesterday_trip_summary',
      'driver_trip_summary',
      'today_products_summary',
      'yesterday_products_summary',
      'latest_trip',
      'ops_period_summary'
    )
  ),
  last_entity_ids jsonb not null default '[]'::jsonb
    check (
      case
        when jsonb_typeof(last_entity_ids) = 'array'
          then jsonb_array_length(last_entity_ids) <= 20
        else false
      end
    ),
  last_entity_names jsonb not null default '[]'::jsonb
    check (
      case
        when jsonb_typeof(last_entity_names) = 'array'
          then jsonb_array_length(last_entity_names) <= 20
        else false
      end
    ),
  last_date_scope text check (
    last_date_scope is null or last_date_scope in (
      'today', 'yesterday', 'this_week', 'this_month', 'this_year',
      'last_week', 'last_month', 'last_year'
    )
  ),
  company_scope text check (company_scope is null or length(company_scope) <= 120),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (sender_phone, business_scope),
  check (expires_at > updated_at)
);

create index if not exists ops_agent_conversation_context_expiry_idx
  on public.ops_agent_conversation_context (expires_at);

alter table public.ops_agent_conversation_context enable row level security;
revoke all on table public.ops_agent_conversation_context from public, anon, authenticated;
grant select, insert, update, delete on table public.ops_agent_conversation_context to service_role;
