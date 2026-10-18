create table if not exists public.ops_driver_action_confirmations (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  sender_phone text not null check (length(sender_phone) between 5 and 32),
  driver_id uuid not null references public.ops_drivers(id) on delete cascade,
  action text not null check (action = 'deactivate'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  check (expires_at > created_at)
);

create index if not exists ops_driver_action_confirmations_pending_sender_idx
  on public.ops_driver_action_confirmations (sender_phone, expires_at)
  where consumed_at is null;

alter table public.ops_driver_action_confirmations enable row level security;
revoke all on public.ops_driver_action_confirmations from public, anon, authenticated;
grant select, insert, update, delete on public.ops_driver_action_confirmations to service_role;

create or replace function public.confirm_ops_driver_deactivation(
  p_token_hash text,
  p_sender_phone text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_confirmation public.ops_driver_action_confirmations%rowtype;
  v_driver_name text;
  v_changed integer;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
     or p_sender_phone is null then
    return jsonb_build_object('status', 'invalid');
  end if;

  select * into v_confirmation
  from public.ops_driver_action_confirmations
  where token_hash = p_token_hash
  for update;

  if not found
     or v_confirmation.sender_phone <> p_sender_phone
     or v_confirmation.action <> 'deactivate'
     or v_confirmation.consumed_at is not null
     or v_confirmation.expires_at <= now() then
    return jsonb_build_object('status', 'invalid');
  end if;

  update public.ops_drivers
  set active = false, updated_at = now()
  where id = v_confirmation.driver_id and active = true
  returning name into v_driver_name;

  get diagnostics v_changed = row_count;

  update public.ops_driver_action_confirmations
  set consumed_at = now()
  where id = v_confirmation.id;

  if v_changed = 0 then
    return jsonb_build_object('status', 'already_inactive');
  end if;

  return jsonb_build_object('status', 'deactivated', 'driver_name', v_driver_name);
end;
$$;

revoke all on function public.confirm_ops_driver_deactivation(text, text) from public, anon, authenticated;
grant execute on function public.confirm_ops_driver_deactivation(text, text) to service_role;
