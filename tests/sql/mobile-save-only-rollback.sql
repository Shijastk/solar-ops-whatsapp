begin;
do $$
declare c uuid:=gen_random_uuid(); other_c uuid:=gen_random_uuid(); driver uuid:=gen_random_uuid();
 m uuid:=gen_random_uuid(); other_m uuid:=gen_random_uuid(); d uuid:=gen_random_uuid(); other_d uuid:=gen_random_uuid();
 trip uuid:=gen_random_uuid(); failed uuid:=gen_random_uuid(); empty_trip uuid:=gen_random_uuid();
 product uuid:=gen_random_uuid(); loop_trip uuid; key text:=gen_random_uuid()::text; n int; before_ledger bigint; activity jsonb; local_today date:=(now() at time zone 'Asia/Kolkata')::date;
begin
 insert into public.stock_companies(id,canonical_name,normalized_name,gstin) values(c,'Synthetic save company',key,'32ZZZZZ7777Z1Z8'),(other_c,'Synthetic other save company',key||' other','33ZZZZZ7777Z1Z8');
 insert into public.ops_drivers(id,name,normalized_name) values(driver,'Synthetic save driver',key);
 insert into public.whatsapp_messages(id,whatsapp_message_id,sender_phone,message_type,received_at,mime_type,original_filename) values(m,'synthetic-save:'||key,'synthetic','document',now(),'application/pdf','synthetic.pdf'),(other_m,'synthetic-save-other:'||key,'synthetic','document',now(),'application/pdf','synthetic.pdf');
 insert into public.document_drafts(id,message_id,parser_version,parse_status,workflow_status,stock_status,stock_company_id,supplier_gstin,document_number) values(d,m,'synthetic','approved','recorded','applied',c,'32ZZZZZ7777Z1Z8','SYNTHETIC-SAVE'),(other_d,other_m,'synthetic','approved','recorded','applied',other_c,'33ZZZZZ7777Z1Z8','SYNTHETIC-OTHER');
 select count(*) into before_ledger from public.stock_ledger;
 begin
  perform public.mobile_save_bill_trip(failed,c,driver,array[m,other_m],null);
  raise exception 'TEST: mixed companies accepted';
 exception when others then if SQLERRM='TEST: mixed companies accepted' then raise; end if; end;
 if exists(select 1 from public.delivery_trips where id=failed) or exists(select 1 from public.trip_documents where trip_id=failed) then raise exception 'Partial group survived failure'; end if;
 perform public.mobile_save_bill_trip(trip,c,driver,array[m],'Synthetic named trip');
 perform public.mobile_save_bill_trip(trip,c,driver,array[m],'Synthetic named trip');
 if (select count(*) from public.trip_documents where trip_id=trip)<>1 or not exists(select 1 from public.delivery_trips where id=trip and status='ready' and custom_name='Synthetic named trip') then raise exception 'Group retry or name failed'; end if;
 begin
  perform public.mobile_save_bill_trip(trip,c,driver,array[m],'Changed retry');
  raise exception 'TEST: changed request accepted';
 exception when others then if SQLERRM='TEST: changed request accepted' then raise; end if; end;
 if (select count(*) from public.stock_ledger)<>before_ledger then raise exception 'Grouping changed inventory'; end if;
 insert into public.delivery_trips(id,sender_phone,company_id) values(empty_trip,'mobile:'||empty_trip,c);
 insert into public.stock_products(id,company_id,canonical_name,normalized_name,unit,normalized_unit) values(product,c,'Synthetic panel',key,'NOS','NOS');
 for n in 1..65 loop
  loop_trip:=gen_random_uuid();
  insert into public.delivery_trips(id,sender_phone,company_id,entry_mode,status,driver_id,completed_at) values(loop_trip,'mobile:'||loop_trip,c,'manual','ready',driver,(local_today::timestamp at time zone 'Asia/Kolkata')+interval '1 minute');
  insert into public.manual_trip_items(trip_id,product_id,quantity) values(loop_trip,product,1);
 end loop;
 activity:=public.get_mobile_trip_activity();
 if not exists(select 1 from jsonb_array_elements(activity->'pending') r where r->>'companyId'=c::text and (r->>'count')::int=1) then raise exception 'Empty trip counted as pending'; end if;
 if not exists(select 1 from jsonb_array_elements(activity->'daily') r where r->>'companyId'=c::text and r->>'day'=local_today::text and (r->>'count')::int=65) then raise exception 'Activity incorrectly page-limited or India day wrong'; end if;
 if has_function_privilege('anon','public.mobile_save_bill_trip(uuid,uuid,uuid,uuid[],text)','execute') or has_function_privilege('authenticated','public.get_mobile_trip_activity()','execute') then raise exception 'Public RPC permissions unsafe'; end if;
end $$;
rollback;
