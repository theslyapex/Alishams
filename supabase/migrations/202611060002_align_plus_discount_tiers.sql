-- Align Plus+ membership discounts with the approved 10% / 18% tiers.
-- Keep legacy purchase-record percentages readable for historical receipts.
alter table public.plus_memberships
  alter column discount_percent set default 10;
alter table public.plus_memberships
  drop constraint if exists plus_memberships_discount_percent_check;
update public.plus_memberships
set discount_percent = case when purchase_count >= 3 then 18 else 10 end,
    updated_at = now();
alter table public.plus_memberships
  add constraint plus_memberships_discount_percent_check
  check (discount_percent in (10,18));

alter table public.plus_purchase_records
  alter column discount_percent set default 10;
alter table public.plus_purchase_records
  drop constraint if exists plus_purchase_records_discount_percent_check;
alter table public.plus_purchase_records
  add constraint plus_purchase_records_discount_percent_check
  check (discount_percent in (10,18,35,50));

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
 values(p.user_id,p.email,'inactive',null,null,0,10,null,now()) on conflict(user_id) do nothing;
 select * into m from public.plus_memberships where user_id=p.user_id for update;
 n:=m.purchase_count+1; pct:=case when n>=3 then 18 else 10 end;
 current_active:=m.status='active' and m.starts_at is not null and m.starts_at<=now() and m.ends_at>now();
 if current_active then s:=m.ends_at; else s:=now(); end if;
 e:=s+interval '30 days';
 update public.plus_memberships set email=p.email,status='active',starts_at=s,ends_at=e,purchase_count=n,discount_percent=pct,last_purchase_at=now(),updated_at=now() where user_id=p.user_id;
 update public.plus_purchase_records set payment_status='paid',paid_at=now(),reviewed_at=now(),discount_percent=pct where id=p.id;
 return jsonb_build_object('ok',true,'purchase_count',n,'discount_percent',pct,'starts_at',s,'ends_at',e);
end $$;
revoke all on function public.finalize_manual_plus_purchase(uuid) from public,anon,authenticated;
grant execute on function public.finalize_manual_plus_purchase(uuid) to service_role;

create or replace function public.finalize_plus_payment(p_intent_id uuid,p_bale_charge_id text,p_provider_charge_id text,p_raw_successful_payment jsonb,p_bale_user_id text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_intent public.plus_payment_intents%rowtype; v_membership public.plus_memberships%rowtype; v_count integer; v_start timestamptz; v_end timestamptz; v_percent integer;
begin
 select * into v_intent from public.plus_payment_intents where id=p_intent_id for update;
 if not found then raise exception 'intent_not_found'; end if;
 if v_intent.status='paid' then
   if v_intent.bale_charge_id=p_bale_charge_id and v_intent.provider_charge_id=p_provider_charge_id then return jsonb_build_object('ok',true,'duplicate',true); end if;
   raise exception 'conflicting_duplicate';
 end if;
 if v_intent.status not in ('pending','precheckout') or v_intent.expires_at<=now() or v_intent.bale_user_id<>p_bale_user_id then raise exception 'invalid_intent'; end if;
 if coalesce((p_raw_successful_payment->>'currency'),'')<>'IRR' or coalesce((p_raw_successful_payment->>'total_amount')::bigint,0)<>v_intent.amount_rial then raise exception 'amount_mismatch'; end if;
 insert into public.plus_memberships(user_id,email,status,starts_at,ends_at,purchase_count,discount_percent,last_purchase_at,updated_at)
 values(v_intent.user_id,v_intent.email,'inactive',null,null,0,10,null,now()) on conflict(user_id) do nothing;
 select * into v_membership from public.plus_memberships where user_id=v_intent.user_id for update;
 v_count:=v_membership.purchase_count+1; v_percent:=case when v_count>=3 then 18 else 10 end;
 if v_membership.status='active' and v_membership.ends_at>now() then
   v_start:=v_membership.starts_at; v_end:=v_membership.ends_at+interval '30 days';
 else
   v_start:=now(); v_end:=v_start+interval '30 days';
 end if;
 update public.plus_memberships set email=v_intent.email,status='active',starts_at=v_start,ends_at=v_end,purchase_count=v_count,discount_percent=v_percent,last_purchase_at=now(),updated_at=now() where user_id=v_intent.user_id;
 update public.plus_payment_intents set status='paid',bale_charge_id=p_bale_charge_id,provider_charge_id=p_provider_charge_id,raw_successful_payment=p_raw_successful_payment,paid_at=now(),updated_at=now() where id=p_intent_id;
 return jsonb_build_object('ok',true,'duplicate',false,'purchase_count',v_count,'discount_percent',v_percent,'starts_at',v_start,'ends_at',v_end);
end $$;
revoke all on function public.finalize_plus_payment(uuid,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.finalize_plus_payment(uuid,text,text,jsonb,text) to service_role;
