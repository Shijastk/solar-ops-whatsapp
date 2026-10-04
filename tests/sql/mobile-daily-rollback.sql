-- Synthetic-only acceptance; never persist fixtures or send messages.
begin;
do $$
declare c uuid:=gen_random_uuid(); other uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); driver uuid:=gen_random_uuid(); t uuid:=gen_random_uuid(); retry uuid:=gen_random_uuid(); key text:=gen_random_uuid()::text; r jsonb; balance numeric;
begin
 insert into public.stock_companies(id,canonical_name,normalized_name,gstin) values(c,'Synthetic daily company',key,'32YYYYY9999Y1Z9'),(other,'Synthetic isolated company',key||' other','33YYYYY9999Y1Z9');
 insert into public.stock_products(id,company_id,canonical_name,normalized_name,unit,normalized_unit) values(p,c,'Synthetic daily panel',key,'NOS','NOS');
 insert into public.ops_drivers(id,name,normalized_name) values(driver,'Synthetic daily driver',key);
 r:=public.mobile_manual_dispatch(t,c,'Synthetic place',driver,2,null,jsonb_build_array(jsonb_build_object('productId',p,'quantity',7)));
 if r->>'status'<>'saved' then raise exception 'manual save failed'; end if;
 r:=public.mobile_manual_dispatch(t,c,'Synthetic place',driver,2,null,jsonb_build_array(jsonb_build_object('productId',p,'quantity',7)));
 if r->>'status'<>'already_saved' then raise exception 'manual retry failed'; end if;
 if (select count(*) from public.stock_ledger where manual_trip_id=t)<>1 then raise exception 'duplicate manual ledger'; end if;
 if (select balance_known from public.stock_balances where product_id=p) then raise exception 'missing stock was guessed'; end if;
 if (select quantity from public.get_mobile_today_stock() where product_id=p)<>7 then raise exception 'daily outgoing wrong'; end if;
 begin
  perform public.mobile_manual_dispatch(retry,other,'Synthetic place',driver,1,null,jsonb_build_array(jsonb_build_object('productId',p,'quantity',1)));
  raise exception 'TEST: cross-company product accepted';
 exception when others then if SQLERRM='TEST: cross-company product accepted' then raise; end if; end;
 if exists(select 1 from public.delivery_trips where id=retry) then raise exception 'failed dispatch partially saved'; end if;
 begin
  perform public.mobile_manual_dispatch(retry,c,'Synthetic place',null,1,null,jsonb_build_array(jsonb_build_object('productId',p,'quantity',1)));
  raise exception 'TEST: missing driver accepted';
 exception when others then if SQLERRM='TEST: missing driver accepted' then raise; end if; end;
 perform public.adjust_stock_balance(p,0,gen_random_uuid());
 if not (select balance_known from public.stock_balances where product_id=p) or (select current_quantity from public.stock_balances where product_id=p)<>0 then raise exception 'confirmed zero missing'; end if;
 perform public.record_stock_in(p,10,retry);perform public.record_stock_in(p,10,retry);
 if (select current_quantity from public.stock_balances where product_id=p)<>10 then raise exception 'incoming stock replayed or did not add'; end if;
 if not exists(select 1 from public.get_mobile_product_catalog() where product_id=p and company_id=c) then raise exception 'catalogue lost zero/history product'; end if;
end $$;
rollback;
