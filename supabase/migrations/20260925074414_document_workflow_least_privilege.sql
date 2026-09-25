-- Restrict workflow tables to the server-side service role with only required CRUD privileges.

revoke all on table public.document_actions
  from anon, authenticated, service_role;
grant select, insert, update, delete
  on table public.document_actions to service_role;

revoke all on table public.document_edit_sessions
  from anon, authenticated, service_role;
grant select, insert, update, delete
  on table public.document_edit_sessions to service_role;
