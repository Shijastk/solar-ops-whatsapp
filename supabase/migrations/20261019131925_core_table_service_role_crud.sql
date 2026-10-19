-- Tighten the explicit service-role grants after the initial client-role
-- revocation: these application paths use CRUD only, not TRUNCATE/REFERENCES/TRIGGER.

revoke all on table
  public.whatsapp_messages,
  public.document_drafts,
  public.document_items,
  public.whatsapp_outbound_messages
from service_role;

grant select, insert, update, delete on table
  public.whatsapp_messages,
  public.document_drafts,
  public.document_items,
  public.whatsapp_outbound_messages
to service_role;
