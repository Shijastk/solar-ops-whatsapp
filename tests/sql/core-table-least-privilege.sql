-- Isolated acceptance for least-privilege grants on core ingestion tables.
-- Run after all repository migrations on the disposable CI database.
do $test$
declare
  v_table text;
  v_tables text[] := array[
    'public.whatsapp_messages',
    'public.document_drafts',
    'public.document_items',
    'public.whatsapp_outbound_messages'
  ];
  v_privilege text;
  v_privileges text[] := array[
    'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
  ];
begin
  foreach v_table in array v_tables loop
    foreach v_privilege in array v_privileges loop
      if has_table_privilege('anon', v_table, v_privilege) then
        raise exception 'anon retains % on %', v_privilege, v_table;
      end if;
      if has_table_privilege('authenticated', v_table, v_privilege) then
        raise exception 'authenticated retains % on %', v_privilege, v_table;
      end if;
    end loop;

    foreach v_privilege in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
      if not has_table_privilege('service_role', v_table, v_privilege) then
        raise exception 'service_role is missing % on %', v_privilege, v_table;
      end if;
    end loop;
  end loop;

  if has_function_privilege('anon', 'public.set_updated_at()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.set_updated_at()', 'EXECUTE')
  then
    raise exception 'client roles retain EXECUTE on public.set_updated_at()';
  end if;
  if not has_function_privilege('service_role', 'public.set_updated_at()', 'EXECUTE') then
    raise exception 'service_role lacks EXECUTE on public.set_updated_at()';
  end if;
end
$test$;

select 'PASS: core ingestion/document tables and trigger function follow least-privilege grants' as result;
