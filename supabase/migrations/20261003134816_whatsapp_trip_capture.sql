-- Lightweight WhatsApp trip-capture sessions and driver directory.

create table if not exists public.ops_drivers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text not null,
  active boolean not null default true,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ops_drivers_name_check check (char_length(btrim(name)) between 1 and 120),
  constraint ops_drivers_normalized_name_check check (char_length(btrim(normalized_name)) between 1 and 120),
  constraint ops_drivers_normalized_name_key unique (normalized_name)
);

create table if not exists public.delivery_trips (
  id uuid primary key default gen_random_uuid(),
  sender_phone text not null,
  status text not null default 'collecting',
  display_name text,
  primary_destination text,
  destination_pincode text,
  destination_district text,
  destination_state text,
  vehicle_number text,
  driver_id uuid references public.ops_drivers(id) on delete set null,
  started_by_message_id uuid references public.whatsapp_messages(id) on delete set null,
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint delivery_trips_status_check check (
    status in (
      'collecting',
      'closing',
      'awaiting_driver',
      'awaiting_driver_name',
      'ready',
      'cancelled'
    )
  ),
  constraint delivery_trips_pincode_check check (
    destination_pincode is null or destination_pincode ~ '^[0-9]{6}$'
  )
);

create unique index if not exists delivery_trips_one_active_sender_idx
  on public.delivery_trips(sender_phone)
  where status in ('collecting', 'closing', 'awaiting_driver', 'awaiting_driver_name');

create index if not exists delivery_trips_created_idx
  on public.delivery_trips(created_at desc);

create table if not exists public.trip_documents (
  trip_id uuid not null references public.delivery_trips(id) on delete cascade,
  message_id uuid not null references public.whatsapp_messages(id) on delete cascade,
  draft_id uuid references public.document_drafts(id) on delete set null,
  processing_status text not null default 'pending',
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (trip_id, message_id),
  constraint trip_documents_processing_status_check check (
    processing_status in ('pending', 'parsed', 'failed')
  )
);

create unique index if not exists trip_documents_message_once_idx
  on public.trip_documents(message_id);

create index if not exists trip_documents_trip_created_idx
  on public.trip_documents(trip_id, created_at);

create table if not exists public.trip_pincode_cache (
  pincode text primary key,
  district text,
  state text,
  post_office text,
  source text not null,
  updated_at timestamptz not null default now(),
  constraint trip_pincode_cache_pincode_check check (pincode ~ '^[0-9]{6}$')
);

alter table public.ops_drivers enable row level security;
alter table public.delivery_trips enable row level security;
alter table public.trip_documents enable row level security;
alter table public.trip_pincode_cache enable row level security;

revoke all on table public.ops_drivers from public, anon, authenticated;
revoke all on table public.delivery_trips from public, anon, authenticated;
revoke all on table public.trip_documents from public, anon, authenticated;
revoke all on table public.trip_pincode_cache from public, anon, authenticated;

grant select, insert, update, delete on table public.ops_drivers to service_role;
grant select, insert, update, delete on table public.delivery_trips to service_role;
grant select, insert, update, delete on table public.trip_documents to service_role;
grant select, insert, update, delete on table public.trip_pincode_cache to service_role;
