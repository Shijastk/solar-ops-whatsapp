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
