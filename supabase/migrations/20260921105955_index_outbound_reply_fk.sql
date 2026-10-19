-- Keep this index in its own production-aligned migration version.
create index if not exists whatsapp_outbound_reply_to_message_idx
  on public.whatsapp_outbound_messages (reply_to_message_id);
