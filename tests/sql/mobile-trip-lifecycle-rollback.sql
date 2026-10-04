begin;
do $$
declare c uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); driver uuid:=gen_random_uuid(); t uuid:=gen_random_uuid(); empty_trip uuid:=gen_random_uuid(); r uuid:=gen_random_uuid(); key text:=gen_random_uuid()::text; before_total numeric;
begin
 insert into public.stock_companies(id,canonical_name,normalized_name,gstin) values(c,'Synthetic lifecycle company',key,'32XXXXX9999X1Z9');
 insert into public.stock_products(id,company_id,canonical_name,normalized_name,unit,normalized_unit) values(p,c,'Synthetic lifecycle panel',key,'NOS','NOS');
 insert into public.ops_drivers(id,name,normalized_name) values(driver,'Synthetic lifecycle driver',key);
 perform public.mobile_manual_dispatch(t,c,'Synthetic place',driver,1,null,jsonb_build_array(jsonb_build_object('productId',p,'quantity',3)));
 select sum(quantity_delta) into before_total from public.stock_ledger where product_id=p;
 perform public.mobile_trip_action(t,r,'rename','Operator name');
 perform public.mobile_trip_action(t,r,'rename','Operator name');
 update public.delivery_trips set display_name='Automatic destination' where id=t;
 if (select display_name from public.delivery_trips where id=t)<>'Operator name' then raise exception 'Custom name overwritten'; end if;
 if (select count(*) from public.mobile_trip_actions where trip_id=t)<>1 then raise exception 'Replayed action repeated'; end if;
 perform public.mobile_trip_action(t,gen_random_uuid(),'complete');
 if (select completed_at from public.delivery_trips where id=t) is null then raise exception 'Completion not recorded'; end if;
 insert into public.delivery_trips(id,sender_phone,company_id,status) values(empty_trip,'mobile:'||empty_trip::text,c,'collecting');
 begin
  perform public.mobile_trip_action(empty_trip,gen_random_uuid(),'complete');
  raise exception 'TEST: unready empty trip completed';
 exception when others then if SQLERRM='TEST: unready empty trip completed' then raise; end if; end;
 perform public.mobile_trip_action(t,gen_random_uuid(),'remove');
 if (select removed_at from public.delivery_trips where id=t) is null then raise exception 'Removal missing'; end if;
 if (select sum(quantity_delta) from public.stock_ledger where product_id=p)<>before_total then raise exception 'Trip removal mutated stock'; end if;
 if not exists(select 1 from public.manual_trip_items where trip_id=t) then raise exception 'Trip items deleted'; end if;
 update public.stock_companies set profile_label='Operator label',photo_png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=' where id=c;
 if (select canonical_name from public.stock_companies where id=c)<>'Synthetic lifecycle company' then raise exception 'Canonical identity changed'; end if;
end $$;
rollback;
