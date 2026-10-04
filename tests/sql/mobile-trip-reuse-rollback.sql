begin;
do $$
declare c uuid:=gen_random_uuid(); other_c uuid:=gen_random_uuid(); old_trip uuid:=gen_random_uuid(); new_trip uuid:=gen_random_uuid(); other_trip uuid:=gen_random_uuid(); m uuid:=gen_random_uuid(); d uuid:=gen_random_uuid(); key text:=gen_random_uuid()::text; before_count bigint;
begin
 insert into public.stock_companies(id,canonical_name,normalized_name,gstin) values(c,'Synthetic reuse company',key,'32WWWWW9999W1Z9'),(other_c,'Synthetic reuse isolated company',key||' other','33WWWWW9999W1Z9');
 insert into public.whatsapp_messages(id,whatsapp_message_id,sender_phone,message_type,received_at,mime_type,original_filename) values(m,'synthetic-reuse:'||key,'synthetic-sender','document',now(),'application/pdf','synthetic.pdf');
 insert into public.document_drafts(id,message_id,parser_version,parse_status,workflow_status,stock_status,stock_company_id,supplier_gstin,document_number) values(d,m,'synthetic','approved','recorded','applied',c,'32WWWWW9999W1Z9','SYNTHETIC-REUSE');
 insert into public.delivery_trips(id,sender_phone,company_id) values(old_trip,'mobile:'||old_trip::text,c),(new_trip,'mobile:'||new_trip::text,c),(other_trip,'mobile:'||other_trip::text,other_c);
 select count(*) into before_count from public.stock_ledger;
 perform public.mobile_attach_trip_bill(old_trip,m);
 begin
  perform public.mobile_attach_trip_bill(new_trip,m);
  raise exception 'TEST: active bill group was stolen';
 exception when others then if SQLERRM='TEST: active bill group was stolen' then raise; end if; end;
 perform public.mobile_trip_action(old_trip,gen_random_uuid(),'remove');
 if not exists(select 1 from public.mobile_trip_actions where trip_id=old_trip and previous_value->'billLinks' @> jsonb_build_array(jsonb_build_object('message_id',m))) then raise exception 'Removed group link not audited'; end if;
 begin
  perform public.mobile_attach_trip_bill(other_trip,m);
  raise exception 'TEST: cross-company bill reused';
 exception when others then if SQLERRM='TEST: cross-company bill reused' then raise; end if; end;
 perform public.mobile_attach_trip_bill(new_trip,m);
 perform public.mobile_attach_trip_bill(new_trip,m);
 if (select count(*) from public.trip_documents where message_id=m)<>1 or not exists(select 1 from public.trip_documents where message_id=m and trip_id=new_trip) then raise exception 'Reattachment missing or repeated'; end if;
 if (select count(*) from public.stock_ledger)<>before_count then raise exception 'Grouping changed stock'; end if;
 if not exists(select 1 from public.document_drafts where id=d and workflow_status='recorded') then raise exception 'Bill changed'; end if;
end $$;
rollback;
