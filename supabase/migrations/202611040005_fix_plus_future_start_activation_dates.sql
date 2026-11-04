create or replace function public.finalize_manual_plus_purchase(p_purchase_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.plus_purchase_records%rowtype; m public.plus_memberships%rowtype; n integer; s timestamptz; e timestamptz; pct integer; current_active boolean;
begin
 select * into p from public.plus_purchase_records where id=p_purchase_id for update;
 if not found then raise exception 'purchase_not_found'; end if;
 if p.payment_provider<>'card_transfer' then raise exception 'invalid_provider'; end if;
 if p.payment_status='paid' then return jsonb_build_object('ok',true,'duplicate',true); end if;
 if p.payment_status<>'pending' or p.receipt_path is null then raise exception 'invalid_purchase_state'; end if;
 insert into public.plus_memberships(user_id,email,status,starts_at,ends_at,purchase_count,discount_percent,last_purchase_at,updated_at)
 values(p.user_id,p.email,'inactive',null,null,0,35,null,now()) on conflict(user_id) do nothing;
 select * into m from public.plus_memberships where user_id=p.user_id for update;
 n:=m.purchase_count+1; pct:=case when n>=3 then 50 else 35 end;
 current_active:=m.status='active' and m.starts_at is not null and m.starts_at<=now() and m.ends_at>now();
 if current_active then s:=m.ends_at; else s:=now(); end if;
 e:=s+interval '30 days';
 update public.plus_memberships set email=p.email,status='active',starts_at=s,ends_at=e,purchase_count=n,discount_percent=pct,last_purchase_at=now(),updated_at=now() where user_id=p.user_id;
 update public.plus_purchase_records set payment_status='paid',paid_at=now(),reviewed_at=now(),discount_percent=pct where id=p.id;
 return jsonb_build_object('ok',true,'purchase_count',n,'discount_percent',pct,'starts_at',s,'ends_at',e);
end $$;
revoke all on function public.finalize_manual_plus_purchase(uuid) from public,anon,authenticated;
grant execute on function public.finalize_manual_plus_purchase(uuid) to service_role;

-- Repair active memberships whose start timestamp was accidentally set in the future.
update public.plus_memberships
set starts_at=now(), ends_at=now()+interval '30 days', updated_at=now()
where status='active' and starts_at>now() and last_purchase_at is not null and last_purchase_at<=now();
