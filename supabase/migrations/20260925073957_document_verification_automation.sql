-- Fail-closed document verification, workflow audit, and interactive reply support.

alter table public.document_drafts
  add column if not exists verification_status text not null default 'not_run',
  add column if not exists verification_provider text,
  add column if not exists verification_model text,
  add column if not exists verification_details jsonb not null default '{}'::jsonb,
  add column if not exists workflow_status text not null default 'pending',
  add column if not exists summary_sent_at timestamptz,
  add column if not exists summary_meta_message_id text;

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

create index if not exists document_drafts_workflow_status_idx
  on public.document_drafts (workflow_status, updated_at desc);

alter table public.whatsapp_outbound_messages
  add column if not exists message_kind text not null default 'text';

alter table public.whatsapp_outbound_messages
  add constraint whatsapp_outbound_messages_message_kind_check
  check (message_kind in ('text', 'interactive'));

create table public.document_actions (
  id uuid primary key default gen_random_uuid(),
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

create index document_actions_draft_created_idx
  on public.document_actions (draft_id, created_at desc);

alter table public.document_actions enable row level security;

revoke all on table public.document_actions from anon, authenticated;
grant select, insert, update, delete on table public.document_actions to service_role;

create table public.document_edit_sessions (
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

create index document_edit_sessions_expires_at_idx
  on public.document_edit_sessions (expires_at);

alter table public.document_edit_sessions enable row level security;

revoke all on table public.document_edit_sessions from anon, authenticated;
grant select, insert, update, delete on table public.document_edit_sessions to service_role;

create trigger set_document_edit_sessions_updated_at
before update on public.document_edit_sessions
for each row execute function public.set_updated_at();
