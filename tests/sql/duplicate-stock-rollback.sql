-- Synthetic production-compatible verification. No outbound messages. Always roll back.
begin;
do $$
declare
 c uuid:=gen_random_uuid(); c2 uuid:=gen_random_uuid(); p uuid:=gen_random_uuid();
 d uuid; m uuid; driver uuid:=gen_random_uuid(); trip uuid:=gen_random_uuid(); request_id uuid:=gen_random_uuid(); ds uuid[]:='{}'; r jsonb; n integer; key text:=gen_random_uuid()::text;
begin
 insert into stock_companies(id,canonical_name,normalized_name,gstin) values(c,'Synthetic duplicate test',key,'32ZZZZZ9999Z1Z9'),(c2,'Synthetic second company',key||' second','33ZZZZZ9999Z1Z9');
 insert into stock_company_aliases(company_id,alias_text,normalized_alias,source) values(c,'Synthetic alias',key,'document');
 insert into stock_products(id,company_id,canonical_name,normalized_name,unit,normalized_unit) values(p,c,'Synthetic panel','synthetic panel','NOS','NOS');
 insert into stock_product_aliases(company_id,product_id,alias_text,normalized_alias,normalized_unit,source) values(c,p,'Synthetic panel','synthetic panel','NOS','document');
 for n in 1..3 loop
  m:=gen_random_uuid(); d:=gen_random_uuid(); ds:=array_append(ds,d);
  insert into whatsapp_messages(id,whatsapp_message_id,sender_phone,message_type,processing_status,received_at) values(m,'synthetic:'||m::text,'synthetic-audit','document','stored',now());
  insert into document_drafts(id,message_id,parser_version,parse_status,workflow_status,verification_status,supplier_gstin,document_number,stock_company_id,eway_bill_number)
  values(d,m,'synthetic-test','approved','recorded','manual_override',case when n=3 then '33ZZZZZ9999Z1Z9' else '32ZZZZZ9999Z1Z9' end,key,case when n=3 then c2 else c end,case when n=1 then 'fixture-'||key else null end);
  insert into document_items(draft_id,line_index,description,normalized_description,quantity,unit) values(d,0,'Synthetic panel','synthetic panel',7,'NOS');
 end loop;
 r:=apply_stock_out_for_draft(ds[1]);
 if r->>'status'<>'applied' then raise exception 'first application failed: %',r; end if;
 r:=apply_stock_out_for_draft(ds[1]);
 if r->>'status'<>'already_applied' then raise exception 'retry failed: %',r; end if;
 r:=apply_stock_out_for_draft(ds[2]);
 if r->>'status'<>'duplicate_document' then raise exception 'cross-draft duplicate escaped: %',r; end if;
 if exists(select 1 from stock_ledger where draft_id=ds[2]) then raise exception 'duplicate mutated ledger'; end if;
 if (select count(*) from stock_ledger where draft_id=ds[1])<>2 then raise exception 'unexpected inferred/out ledger count'; end if;
 insert into ops_drivers(id,name,normalized_name) values(driver,'Synthetic driver',key);
 insert into delivery_trips(id,sender_phone,company_id) values(trip,'synthetic:'||trip::text,c);
 select message_id into m from document_drafts where id=ds[1];
 r:=mobile_attach_trip_bill(trip,m);
 begin
  perform mobile_update_trip(trip,null,true);
  raise exception 'TEST: closed without a driver';
 exception when others then
  if SQLERRM='TEST: closed without a driver' then raise; end if;
 end;
 r:=mobile_update_trip(trip,driver,true);
 if (select status from delivery_trips where id=trip)<>'ready' then raise exception 'trip did not close'; end if;
 begin
  perform mobile_attach_trip_bill(trip,m);
  raise exception 'TEST: attached to closed trip';
 exception when others then
  if SQLERRM='TEST: attached to closed trip' then raise; end if;
 end;
 select id into d from document_items where draft_id=ds[1];
 r:=mobile_bill_change(ds[1],'quantity',d,5,null,request_id);
 if (select quantity from document_items where id=d)<>5 then raise exception 'quantity correction failed'; end if;
 r:=mobile_bill_change(ds[1],'quantity',d,5,null,request_id);
 if r->>'status'<>'already_saved' then raise exception 'correction retry was not idempotent'; end if;
 if (select count(*) from document_actions where draft_id=ds[1])<>1 then raise exception 'audit repeated'; end if;
 r:=mobile_bill_change(ds[1],'cancel',null,null,null,gen_random_uuid());
 if (select workflow_status from document_drafts where id=ds[1])<>'cancelled' or (select stock_status from document_drafts where id=ds[1])<>'reversed' then raise exception 'cancel did not restore stock'; end if;
 if (select count(*) from document_actions where draft_id=ds[1])<>2 then raise exception 'cancel audit missing'; end if;
 r:=claim_stock_document(ds[3]);
 if r->>'status'<>'claimed' then raise exception 'company isolation failed: %',r; end if;
 update document_drafts set supplier_gstin=null,document_number=null,eway_bill_number=null where id=ds[3];
 r:=claim_stock_document(ds[3]);
 if r->>'status'<>'not_ready' then raise exception 'missing identity did not fail closed'; end if;
end $$;
select 'PASS: first application, retry, duplicate with missing eway, zero duplicate ledger changes, separate company identity, missing identity, document aliases, atomic quantity/cancel audit, driver gate and closed-trip attachment gate' as result;
rollback;
