-- Alishams Club: lifetime tiers, spendable points, public league and Diamond teaser requests.
create table if not exists public.club_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'عضو باشگاه',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.club_point_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  points integer not null check (points <> 0),
  event_type text not null check (event_type in ('plus_purchase','first_purchase_bonus','service_purchase','referral_bonus','reward_redemption','admin_adjustment')),
  source_id text not null,
  description text not null default '',
  created_at timestamptz not null default now(),
  unique(user_id,event_type,source_id)
);
create index if not exists club_ledger_user_created_idx on public.club_point_ledger(user_id,created_at desc);
create index if not exists club_ledger_league_idx on public.club_point_ledger(user_id) where points > 0;

create table if not exists public.club_teaser_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  week_key text not null,
  brief text not null,
  status text not null default 'pending' check (status in ('pending','in_progress','delivered','rejected')),
  admin_note text not null default '',
  delivery_url text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,week_key)
);
create index if not exists club_teaser_created_idx on public.club_teaser_requests(created_at desc);

alter table public.club_profiles enable row level security;
alter table public.club_point_ledger enable row level security;
alter table public.club_teaser_requests enable row level security;
drop policy if exists club_profile_read_own on public.club_profiles;
create policy club_profile_read_own on public.club_profiles for select to authenticated using(auth.uid()=user_id);
drop policy if exists club_ledger_read_own on public.club_point_ledger;
create policy club_ledger_read_own on public.club_point_ledger for select to authenticated using(auth.uid()=user_id);
drop policy if exists club_teaser_read_own on public.club_teaser_requests;
create policy club_teaser_read_own on public.club_teaser_requests for select to authenticated using(auth.uid()=user_id);

create or replace function public.club_tier(p_lifetime integer)
returns text language sql immutable as $$
 select case when p_lifetime>=3500 then 'diamond' when p_lifetime>=1500 then 'gold' when p_lifetime>=500 then 'silver' else 'bronze' end;
$$;

create or replace function public.club_award_points(p_user_id uuid,p_points integer,p_event_type text,p_source_id text,p_description text default '')
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if p_points<=0 or p_points>100000 or p_event_type not in ('plus_purchase','first_purchase_bonus','service_purchase','referral_bonus','admin_adjustment') then
   raise exception 'invalid_club_award';
 end if;
 insert into public.club_point_ledger(user_id,points,event_type,source_id,description)
 values(p_user_id,p_points,p_event_type,left(coalesce(p_source_id,''),180),left(coalesce(p_description,''),300))
 on conflict(user_id,event_type,source_id) do nothing;
 return found;
end $$;

create or replace function public.club_award_plus_purchase()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_user uuid; v_source text; v_first boolean;
begin
 if new.payment_status='paid' and (tg_op='INSERT' or old.payment_status is distinct from 'paid') then
   v_user:=new.user_id; v_source:=new.id::text;
   perform public.club_award_points(v_user,200,'plus_purchase',v_source,'خرید یا تمدید عضویت پلاس+');
   select not exists(select 1 from public.club_point_ledger where user_id=v_user and event_type='first_purchase_bonus') into v_first;
   if v_first then perform public.club_award_points(v_user,100,'first_purchase_bonus','first','هدیه اولین خرید'); end if;
 end if;
 return new;
end $$;

drop trigger if exists club_plus_record_award on public.plus_purchase_records;
create trigger club_plus_record_award after insert or update of payment_status on public.plus_purchase_records
for each row execute function public.club_award_plus_purchase();

create or replace function public.club_award_bale_plus_purchase()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_first boolean;
begin
 if new.status='paid' and (tg_op='INSERT' or old.status is distinct from 'paid') then
   perform public.club_award_points(new.user_id,200,'plus_purchase',new.id::text,'خرید یا تمدید عضویت پلاس+');
   select not exists(select 1 from public.club_point_ledger where user_id=new.user_id and event_type='first_purchase_bonus') into v_first;
   if v_first then perform public.club_award_points(new.user_id,100,'first_purchase_bonus','first','هدیه اولین خرید'); end if;
 end if;
 return new;
end $$;
drop trigger if exists club_bale_plus_award on public.plus_payment_intents;
create trigger club_bale_plus_award after insert or update of status on public.plus_payment_intents
for each row execute function public.club_award_bale_plus_purchase();

create or replace function public.club_award_service_purchase(p_user_id uuid,p_order_id uuid,p_amount_toman bigint)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare v_points integer;
begin
 if p_amount_toman<0 or p_amount_toman>100000000000 then raise exception 'invalid_amount'; end if;
 v_points:=floor(p_amount_toman/100000.0)::integer*10;
 if v_points>0 then perform public.club_award_points(p_user_id,v_points,'service_purchase',p_order_id::text,'امتیاز خرید خدمات تأییدشده'); end if;
 return v_points;
end $$;

create or replace function public.club_redeem_points(p_user_id uuid,p_points integer,p_reward_toman integer)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_balance integer; v_cost integer;
begin
 if p_points not in (500,1000,2000,3500) then raise exception 'invalid_reward'; end if;
 v_cost:=case p_points when 500 then 50000 when 1000 then 120000 when 2000 then 300000 when 3500 then 600000 end;
 if p_reward_toman<>v_cost then raise exception 'invalid_reward_value'; end if;
 perform pg_advisory_xact_lock(hashtext(p_user_id::text));
 select coalesce(sum(points),0) into v_balance from public.club_point_ledger where user_id=p_user_id;
 if v_balance<p_points then raise exception 'insufficient_points'; end if;
 insert into public.club_point_ledger(user_id,points,event_type,source_id,description)
 values(p_user_id,-p_points,'reward_redemption',gen_random_uuid()::text,'دریافت کد تخفیف '+v_cost::text+' تومانی');
 return jsonb_build_object('ok',true,'points_spent',p_points,'reward_toman',v_cost);
end $$;

revoke all on function public.club_award_points(uuid,integer,text,text,text) from public,anon,authenticated;
revoke all on function public.club_award_service_purchase(uuid,uuid,bigint) from public,anon,authenticated;
revoke all on function public.club_redeem_points(uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.club_award_points(uuid,integer,text,text,text) to service_role;
grant execute on function public.club_award_service_purchase(uuid,uuid,bigint) to service_role;
grant execute on function public.club_redeem_points(uuid,integer,integer) to service_role;


create or replace function public.club_account_summary(p_user_id uuid)
returns table(balance bigint,lifetime bigint)
language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(sum(points),0)::bigint,
        coalesce(sum(greatest(points,0)),0)::bigint
 from public.club_point_ledger where user_id=p_user_id;
$$;

create or replace function public.club_leaderboard()
returns table(user_id uuid,display_name text,lifetime_points bigint,tier text)
language sql stable security definer set search_path=public,pg_temp as $$
 select l.user_id,coalesce(p.display_name,'عضو باشگاه'),
        sum(greatest(l.points,0))::bigint,
        public.club_tier(sum(greatest(l.points,0))::integer)
 from public.club_point_ledger l
 left join public.club_profiles p on p.user_id=l.user_id
 group by l.user_id,p.display_name
 having sum(greatest(l.points,0))>0
 order by sum(greatest(l.points,0)) desc,l.user_id
 limit 10;
$$;
revoke all on function public.club_account_summary(uuid) from public,anon,authenticated;
revoke all on function public.club_leaderboard() from public,anon,authenticated;
grant execute on function public.club_account_summary(uuid) to service_role;
grant execute on function public.club_leaderboard() to service_role;
