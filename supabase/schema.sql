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

-- Structured document parsing and manual reply schema.
-- Additive Solar Ops document parsing and manual reply schema.

create table if not exists public.document_drafts (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null unique references public.whatsapp_messages(id) on delete cascade,
  parser_version text not null,
  parse_status text not null check (parse_status in ('ready_for_review','needs_review','needs_ocr','failed','approved')),
  document_type text,
  supplier_name text,
  supplier_gstin text,
  supplier_address text,
  document_number text,
  document_date date,
  eway_bill_number text,
  consignee_name text,
  consignee_address text,
  consignee_gstin text,
  consignee_pincode text,
  consignee_phone text,
  buyer_name text,
  buyer_address text,
  buyer_gstin text,
  buyer_pincode text,
  buyer_phone text,
  destination text,
  dispatch_from_address text,
  vehicle_number text,
  approximate_distance_km integer,
  eway_generated_at_text text,
  eway_valid_until_text text,
  supply_type text,
  transaction_type text,
  taxable_amount numeric(18,2),
  cgst_amount numeric(18,2),
  sgst_amount numeric(18,2),
  total_amount numeric(18,2),
  page_count integer,
  extracted_text text,
  text_sha256 text,
  text_length integer,
  missing_fields jsonb not null default '[]'::jsonb,
  extra_fields jsonb not null default '{}'::jsonb,
  parse_error text,
  extracted_at timestamptz not null default now(),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists document_drafts_parse_status_idx
  on public.document_drafts (parse_status, extracted_at desc);

create table if not exists public.document_items (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.document_drafts(id) on delete cascade,
  line_index integer not null check (line_index >= 0),
  source_line_number integer,
  description text not null,
  normalized_description text not null,
  hsn_sac text,
  quantity numeric(18,3),
  unit text,
  rate numeric(18,2),
  amount numeric(18,2),
  created_at timestamptz not null default now(),
  unique (draft_id, line_index)
);

create index if not exists document_items_normalized_description_idx
  on public.document_items (normalized_description);

create table if not exists public.whatsapp_outbound_messages (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  meta_message_id text unique,
  reply_to_message_id uuid references public.whatsapp_messages(id) on delete set null,
  recipient_phone text not null,
  body text not null,
  status text not null default 'queued'
    check (status in ('queued','sent','delivered','read','failed','deleted')),
  sent_at timestamptz,
  status_updated_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists whatsapp_outbound_recipient_created_idx
  on public.whatsapp_outbound_messages (recipient_phone, created_at desc);

create index if not exists whatsapp_outbound_reply_to_message_idx
  on public.whatsapp_outbound_messages (reply_to_message_id);

alter table public.document_drafts enable row level security;
alter table public.document_items enable row level security;
alter table public.whatsapp_outbound_messages enable row level security;

drop trigger if exists set_document_drafts_updated_at on public.document_drafts;
create trigger set_document_drafts_updated_at
before update on public.document_drafts
for each row execute function public.set_updated_at();

drop trigger if exists set_whatsapp_outbound_messages_updated_at on public.whatsapp_outbound_messages;
create trigger set_whatsapp_outbound_messages_updated_at
before update on public.whatsapp_outbound_messages
for each row execute function public.set_updated_at();


-- Fail-closed document verification, workflow audit, and interactive reply support.

alter table public.document_drafts
  add column if not exists verification_status text not null default 'not_run',
  add column if not exists verification_provider text,
  add column if not exists verification_model text,
  add column if not exists verification_details jsonb not null default '{}'::jsonb,
  add column if not exists workflow_status text not null default 'pending',
  add column if not exists summary_sent_at timestamptz,
  add column if not exists summary_meta_message_id text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'document_drafts_verification_status_check'
  ) then
    alter table public.document_drafts
      add constraint document_drafts_verification_status_check
      check (
        verification_status in (
          'not_run',
          'verified',
          'needs_review',
          'failed',
          'manual_override'
        )
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'document_drafts_workflow_status_check'
  ) then
    alter table public.document_drafts
      add constraint document_drafts_workflow_status_check
      check (
        workflow_status in (
          'pending',
          'recorded',
          'review_required',
          'cancelled'
        )
      );
  end if;
end
$$;

create index if not exists document_drafts_workflow_status_idx
  on public.document_drafts (workflow_status, updated_at desc);

alter table public.whatsapp_outbound_messages
  add column if not exists message_kind text not null default 'text';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'whatsapp_outbound_messages_message_kind_check'
  ) then
    alter table public.whatsapp_outbound_messages
      add constraint whatsapp_outbound_messages_message_kind_check
      check (message_kind in ('text', 'interactive'));
  end if;
end
$$;

create table if not exists public.document_actions (
  id uuid primary key default gen_random_uuid(),
  action_key uuid not null unique,
  draft_id uuid not null references public.document_drafts(id) on delete cascade,
  source_message_id uuid references public.whatsapp_messages(id) on delete set null,
  action text not null
    check (
      action in (
        'auto_recorded',
        'summary_sent',
        'review_required',
        'automation_failed',
        'edit_requested',
        'edit_applied',
        'cancelled'
      )
    ),
  field_key text,
  previous_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now()
);

create index if not exists document_actions_draft_created_idx
  on public.document_actions (draft_id, created_at desc);

alter table public.document_actions enable row level security;

revoke all on table public.document_actions from anon, authenticated;
grant select, insert, update, delete on table public.document_actions to service_role;

create table if not exists public.document_edit_sessions (
  id uuid primary key default gen_random_uuid(),
  sender_phone text not null unique,
  draft_id uuid not null references public.document_drafts(id) on delete cascade,
  target_kind text not null
    check (
      target_kind in (
        'document_number',
        'vehicle_number',
        'item_quantity'
      )
    ),
  target_item_id uuid references public.document_items(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (target_kind = 'item_quantity' and target_item_id is not null)
    or
    (target_kind <> 'item_quantity' and target_item_id is null)
  )
);

create index if not exists document_edit_sessions_expires_at_idx
  on public.document_edit_sessions (expires_at);

alter table public.document_edit_sessions enable row level security;

revoke all on table public.document_edit_sessions from anon, authenticated;
grant select, insert, update, delete on table public.document_edit_sessions to service_role;

drop trigger if exists set_document_edit_sessions_updated_at
  on public.document_edit_sessions;

create trigger set_document_edit_sessions_updated_at
before update on public.document_edit_sessions
for each row execute function public.set_updated_at();


-- Idempotent audit keys for Meta webhook retries.
alter table public.document_actions
  add column if not exists action_key uuid;

create unique index if not exists document_actions_action_key_idx
  on public.document_actions (action_key);
