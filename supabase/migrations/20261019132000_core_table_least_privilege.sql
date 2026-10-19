-- Keep inbound/document tables accessible only through the server-side service role.
-- RLS without policies blocks ordinary row access, but explicit grants should also
-- follow least privilege; TRUNCATE and trigger privileges are not governed by RLS.

revoke all on table
  public.whatsapp_messages,
  public.document_drafts,
  public.document_items,
  public.whatsapp_outbound_messages
from public, anon, authenticated;

grant select, insert, update, delete on table
  public.whatsapp_messages,
  public.document_drafts,
  public.document_items,
  public.whatsapp_outbound_messages
to service_role;

revoke all on function public.set_updated_at()
from public, anon, authenticated;

grant execute on function public.set_updated_at() to service_role;
