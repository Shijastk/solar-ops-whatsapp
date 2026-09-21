-- Solar Ops WhatsApp ingestion schema
-- Run this once in Supabase SQL Editor.

create table if not exists public.whatsapp_messages (
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
  processing_status text not null default 'received'
    check (processing_status in ('received', 'stored', 'failed', 'ignored')),
  error_message text,
  received_at timestamptz not null,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists whatsapp_messages_received_at_idx
  on public.whatsapp_messages (received_at desc);

create index if not exists whatsapp_messages_sender_phone_idx
  on public.whatsapp_messages (sender_phone, received_at desc);

create index if not exists whatsapp_messages_processing_status_idx
  on public.whatsapp_messages (processing_status, received_at desc);

alter table public.whatsapp_messages enable row level security;

-- No anon/authenticated policies are intentionally created.
-- The webhook uses the server-side Supabase secret key and bypasses RLS.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_whatsapp_messages_updated_at
  on public.whatsapp_messages;

create trigger set_whatsapp_messages_updated_at
before update on public.whatsapp_messages
for each row
execute function public.set_updated_at();

-- Create the private Storage bucket in the Supabase dashboard:
-- Storage -> New bucket -> "whatsapp-media" -> Public OFF.
