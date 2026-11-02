-- Source record for the additive Bale wallet payment hardening applied to Supabase.
-- Existing financial rows are not rewritten by this script.

alter table public.bale_payment_intents
  add column if not exists payment_mode text not null default 'test',
  add column if not exists expires_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid='public.bale_payment_intents'::regclass and conname='bale_payment_intents_payment_mode_check') then
    alter table public.bale_payment_intents add constraint bale_payment_intents_payment_mode_check check (payment_mode in ('test','live'));
  end if;
end $$;

create index if not exists bale_payment_intents_active_project_idx
  on public.bale_payment_intents(project_id,expires_at desc)
  where status in ('pending','precheckout');

create or replace function public.create_bale_payment_intent(
  p_project_id uuid,p_customer_user_id uuid,p_customer_email text,p_invoice_payload text,p_payment_mode text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_project public.client_projects%rowtype;
  v_existing public.bale_payment_intents%rowtype;
  v_paid numeric(18,2);
  v_remaining numeric(18,2);
  v_rial numeric(20,0);
  v_new public.bale_payment_intents%rowtype;
begin
  if p_payment_mode not in ('test','live') then raise exception 'Payment mode is invalid'; end if;
  if p_customer_user_id is null or nullif(trim(p_customer_email),'') is null then raise exception 'Customer identity is required'; end if;
  if length(coalesce(p_invoice_payload,''))<1 or octet_length(p_invoice_payload)>128 then raise exception 'Invoice payload is invalid'; end if;

  select * into v_project from public.client_projects where id=p_project_id for update;
  if not found or lower(trim(v_project.client_email))<>lower(trim(p_customer_email)) then raise exception 'Project does not belong to customer'; end if;

  select coalesce(sum(amount),0) into v_paid from public.project_payments where project_id=p_project_id and confirmed=true;
  v_remaining:=greatest(0,coalesce(v_project.total_price,0)-v_paid);
  if v_remaining<=0 then raise exception 'Project is already settled'; end if;
  if v_remaining*10<>trunc(v_remaining*10) then raise exception 'Project balance cannot be represented in Rial'; end if;
  v_rial:=(v_remaining*10)::numeric(20,0);
  if v_rial>2147483647 then raise exception 'Project balance exceeds Bale invoice limit'; end if;

  select * into v_existing from public.bale_payment_intents
  where project_id=p_project_id and payment_mode=p_payment_mode
    and status in ('pending','precheckout') and expires_at>now()
  order by created_at desc limit 1 for update;

  if found then
    return jsonb_build_object('id',v_existing.id,'amount_toman',v_existing.amount_toman,'amount_rial',v_existing.amount_rial,
      'invoice_url',v_existing.invoice_url,'expires_at',v_existing.expires_at,'status',v_existing.status,'existing',true);
  end if;

  insert into public.bale_payment_intents(project_id,customer_user_id,customer_email,amount_toman,amount_rial,currency,invoice_payload,status,payment_mode,expires_at)
  values(p_project_id,p_customer_user_id,lower(trim(p_customer_email)),v_remaining,v_rial,'IRR',p_invoice_payload,'pending',p_payment_mode,now()+interval '15 minutes')
  returning * into v_new;

  return jsonb_build_object('id',v_new.id,'amount_toman',v_new.amount_toman,'amount_rial',v_new.amount_rial,
    'invoice_url',v_new.invoice_url,'expires_at',v_new.expires_at,'status',v_new.status,'existing',false);
end;
$$;

create or replace function public.validate_bale_precheckout(
  p_invoice_payload text,p_total_amount bigint,p_currency text,p_bale_user_id text,p_payment_mode text,p_pre_checkout_query_id text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_project_id uuid;
  v_project public.client_projects%rowtype;
  v_intent public.bale_payment_intents%rowtype;
  v_paid numeric(18,2);
  v_remaining numeric(18,2);
begin
  select project_id into v_project_id from public.bale_payment_intents where invoice_payload=p_invoice_payload;
  if not found then return jsonb_build_object('ok',false,'reason','unknown_invoice'); end if;
  select * into v_project from public.client_projects where id=v_project_id for update;
  if not found then return jsonb_build_object('ok',false,'reason','project_missing'); end if;
  select * into v_intent from public.bale_payment_intents where invoice_payload=p_invoice_payload for update;
  if not found then return jsonb_build_object('ok',false,'reason','unknown_invoice'); end if;

  if v_intent.status not in ('pending','precheckout') or v_intent.payment_mode<>p_payment_mode
    or v_intent.expires_at is null or v_intent.expires_at<=now() or p_currency<>'IRR' or v_intent.currency<>'IRR'
    or v_intent.amount_rial<>p_total_amount or nullif(p_bale_user_id,'') is null
    or (v_intent.bale_user_id is not null and v_intent.bale_user_id<>p_bale_user_id) then
    return jsonb_build_object('ok',false,'reason','invalid_invoice');
  end if;

  select coalesce(sum(amount),0) into v_paid from public.project_payments where project_id=v_project_id and confirmed=true;
  v_remaining:=greatest(0,coalesce(v_project.total_price,0)-v_paid);
  if v_remaining<=0 or v_remaining<>v_intent.amount_toman then return jsonb_build_object('ok',false,'reason','balance_changed'); end if;

  update public.bale_payment_intents set status='precheckout',bale_user_id=p_bale_user_id,
    bale_pre_checkout_query_id=p_pre_checkout_query_id,updated_at=now() where id=v_intent.id;
  return jsonb_build_object('ok',true,'intent_id',v_intent.id);
end;
$$;

create or replace function public.finalize_bale_payment(
  p_intent_id uuid,p_bale_charge_id text,p_provider_charge_id text,p_raw_successful_payment jsonb,p_bale_user_id text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_project_id uuid;
  v_project public.client_projects%rowtype;
  v_intent public.bale_payment_intents%rowtype;
  v_paid numeric(18,2);
  v_remaining numeric(18,2);
begin
  select project_id into v_project_id from public.bale_payment_intents where id=p_intent_id;
  if not found then raise exception 'Payment intent not found'; end if;
  select * into v_project from public.client_projects where id=v_project_id for update;
  if not found then raise exception 'Project not found'; end if;
  select * into v_intent from public.bale_payment_intents where id=p_intent_id for update;
  if not found then raise exception 'Payment intent not found'; end if;

  if v_intent.status='paid' then
    if v_intent.bale_charge_id=p_bale_charge_id and v_intent.provider_charge_id=p_provider_charge_id then
      return jsonb_build_object('ok',true,'duplicate',true);
    end if;
    raise exception 'Payment intent was already finalized with a different transaction';
  end if;
  if v_intent.status not in ('pending','precheckout') then raise exception 'Payment intent is not payable'; end if;
  if nullif(p_bale_charge_id,'') is null or nullif(p_provider_charge_id,'') is null or nullif(p_bale_user_id,'') is null then
    raise exception 'Payment transaction identifiers are required';
  end if;
  if v_intent.bale_user_id is null or v_intent.bale_user_id<>p_bale_user_id then raise exception 'Bale user does not match pre-checkout user'; end if;

  select coalesce(sum(amount),0) into v_paid from public.project_payments where project_id=v_project_id and confirmed=true;
  v_remaining:=greatest(0,coalesce(v_project.total_price,0)-v_paid);
  if v_intent.amount_toman>v_remaining then raise exception 'Payment exceeds current outstanding project balance'; end if;

  insert into public.project_payments(project_id,amount,method,note,confirmed,payment_intent_id)
  values(v_project_id,v_intent.amount_toman,'online','پرداخت کیف پول بله | تراکنش '||p_provider_charge_id,true,v_intent.id);

  update public.bale_payment_intents set status='paid',bale_charge_id=p_bale_charge_id,provider_charge_id=p_provider_charge_id,
    raw_successful_payment=p_raw_successful_payment,paid_at=now(),updated_at=now() where id=v_intent.id;
  return jsonb_build_object('ok',true,'duplicate',false);
end;
$$;

revoke all on function public.create_bale_payment_intent(uuid,uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.validate_bale_precheckout(text,bigint,text,text,text,text) from public,anon,authenticated;
revoke all on function public.finalize_bale_payment(uuid,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.create_bale_payment_intent(uuid,uuid,text,text,text) to service_role;
grant execute on function public.validate_bale_precheckout(text,bigint,text,text,text,text) to service_role;
grant execute on function public.finalize_bale_payment(uuid,text,text,jsonb,text) to service_role;
