-- Ensure audit records remain idempotent when Meta retries a webhook.

alter table public.document_actions
  add column action_key uuid;

alter table public.document_actions
  alter column action_key set not null;

create unique index document_actions_action_key_idx
  on public.document_actions (action_key);
