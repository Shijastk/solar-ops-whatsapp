-- Minimal pre-migration application schema for isolated stock-ledger integration tests.
-- This fixture is used only by the disposable PostgreSQL service in GitHub Actions.
create role anon;
create role authenticated;
create role service_role;

create schema if not exists extensions;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

create table public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  whatsapp_message_id text not null unique,
  waba_id text,
  phone_number_id text,
  display_phone_number text,
  sender_phone text not null,
  sender_name text,
  message_type text not null,
  text_body text,
  media_id text,
  original_filename text,
  mime_type text,
  media_sha256 text,
  media_size_bytes bigint,
  storage_path text,
  processing_status text not null default 'received',
  error_message text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
