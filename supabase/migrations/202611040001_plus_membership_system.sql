create table if not exists public.plus_memberships (
 user_id uuid primary key references auth.users(id) on delete cascade,
 email text not null,
 status text not null default 'inactive' check (status in ('active','inactive','suspended')),
 starts_at timestamptz,
 ends_at timestamptz,
 purchase_count integer not null default 0 check (purchase_count >= 0),
 discount_percent integer not null default 35 check (discount_percent in (35,50)),
 last_purchase_at timestamptz,
 admin_note text not null default '',
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table if not exists public.plus_purchase_records (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 email text not null,
 amount_toman bigint not null default 2000000,
 discount_percent integer not null check (discount_percent in (35,50)),
 payment_status text not null default 'pending' check (payment_status in ('pending','paid','failed','cancelled')),
 payment_provider text not null default 'bale',
 payment_reference text unique,
 starts_at timestamptz,
 ends_at timestamptz,
 created_at timestamptz not null default now(),
 paid_at timestamptz
);
create table if not exists public.plus_reel_requests (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 reel_url text not null,
 request_day date not null default (timezone('Asia/Tehran',now()))::date,
 views_requested integer not null default 500 check (views_requested=500),
 status text not null default 'pending' check (status in ('pending','approved','delivered','rejected')),
 admin_note text not null default '',
 delivered_views integer not null default 0 check (delivered_views between 0 and 500),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(user_id,request_day)
);
create table if not exists public.plus_domain_requests (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 email text not null,
 brand_name text not null,
 desired_domain text not null,
 related_order text not null default '',
 status text not null default 'pending' check (status in ('pending','checking','registered','rejected')),
 admin_note text not null default '',
 membership_period_start timestamptz not null default now(),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table public.plus_domain_requests add column if not exists membership_period_start timestamptz;
update public.plus_domain_requests set membership_period_start=created_at where membership_period_start is null;
alter table public.plus_domain_requests alter column membership_period_start set not null;
create unique index if not exists plus_one_domain_per_membership_period on public.plus_domain_requests(user_id,membership_period_start);
create table if not exists public.plus_payment_intents (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 email text not null,
 amount_toman bigint not null default 2000000 check (amount_toman=2000000),
 amount_rial bigint not null default 20000000 check (amount_rial=20000000),
 invoice_payload text not null unique,
 invoice_url text,
 bale_user_id text not null,
 payment_mode text not null check (payment_mode in ('test','live')),
 status text not null default 'pending' check (status in ('pending','precheckout','paid','failed','expired')),
 bale_pre_checkout_query_id text,
 bale_charge_id text unique,
 provider_charge_id text,
 raw_successful_payment jsonb,
 paid_at timestamptz,
 expires_at timestamptz not null default (now()+interval '15 minutes'),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table public.plus_memberships enable row level security;
alter table public.plus_purchase_records enable row level security;
alter table public.plus_reel_requests enable row level security;
alter table public.plus_domain_requests enable row level security;
alter table public.plus_payment_intents enable row level security;
drop policy if exists plus_memberships_read_own on public.plus_memberships;
create policy plus_memberships_read_own on public.plus_memberships for select to authenticated using (auth.uid()=user_id);
drop policy if exists plus_purchase_read_own on public.plus_purchase_records;
create policy plus_purchase_read_own on public.plus_purchase_records for select to authenticated using (auth.uid()=user_id);
drop policy if exists plus_reels_read_own on public.plus_reel_requests;
create policy plus_reels_read_own on public.plus_reel_requests for select to authenticated using (auth.uid()=user_id);
drop policy if exists plus_domains_read_own on public.plus_domain_requests;
create policy plus_domains_read_own on public.plus_domain_requests for select to authenticated using (auth.uid()=user_id);
drop policy if exists plus_payment_intents_read_own on public.plus_payment_intents;
create policy plus_payment_intents_read_own on public.plus_payment_intents for select to authenticated using (auth.uid()=user_id);
create index if not exists plus_reels_user_day_idx on public.plus_reel_requests(user_id,request_day desc);
create index if not exists plus_domains_user_created_idx on public.plus_domain_requests(user_id,created_at desc);
create index if not exists plus_payment_user_idx on public.plus_payment_intents(user_id,created_at desc);
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
 v_start:=greatest(now(),coalesce(v_membership.ends_at,now()));
 if v_membership.status<>'active' or v_membership.ends_at is null or v_membership.ends_at<=now() then v_start:=now(); end if;
 v_end:=v_start+interval '30 days';
 update public.plus_memberships set email=v_intent.email,status='active',starts_at=v_start,ends_at=v_end,purchase_count=v_count,discount_percent=v_percent,last_purchase_at=now(),updated_at=now() where user_id=v_intent.user_id;
 update public.plus_payment_intents set status='paid',bale_charge_id=p_bale_charge_id,provider_charge_id=p_provider_charge_id,raw_successful_payment=p_raw_successful_payment,paid_at=now(),updated_at=now() where id=p_intent_id;
 return jsonb_build_object('ok',true,'duplicate',false,'purchase_count',v_count,'discount_percent',v_percent,'starts_at',v_start,'ends_at',v_end);
end $$;
revoke all on function public.finalize_plus_payment(uuid,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.finalize_plus_payment(uuid,text,text,jsonb,text) to service_role;
