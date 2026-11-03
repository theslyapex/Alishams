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
 values(v_intent.user_id,v_intent.email,'inactive',null,null,0,35,null,now()) on conflict(user_id) do nothing;
 select * into v_membership from public.plus_memberships where user_id=v_intent.user_id for update;
 v_count:=v_membership.purchase_count+1; v_percent:=case when v_count>=3 then 50 else 35 end;
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