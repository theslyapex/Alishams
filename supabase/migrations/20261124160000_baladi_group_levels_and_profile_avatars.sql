alter table public.baladi_groups
 add column if not exists group_level integer not null default 1 check (group_level between 1 and 3),
 add column if not exists upgrade_progress integer not null default 0 check (upgrade_progress >= 0);
alter table public.baladi_game_profiles add column if not exists equipped_avatar_id text;
alter table public.baladi_cosmetic_catalog drop constraint if exists baladi_cosmetic_catalog_kind_check;
alter table public.baladi_cosmetic_catalog add constraint baladi_cosmetic_catalog_kind_check check (kind in ('avatar_unlock','avatar','frame','sticker'));
alter table public.baladi_cosmetic_catalog drop constraint if exists baladi_cosmetic_catalog_price_coins_check;
alter table public.baladi_cosmetic_catalog add constraint baladi_cosmetic_catalog_price_coins_check check (price_coins >= 0 and price_coins <= 100000);
insert into public.baladi_cosmetic_catalog(id,kind,display_name,price_coins,asset_path,sort_order) values
('avatar_hero','avatar','جنگجوی پارسی',4000,'avatars/hero.svg',20),
('avatar_scholar','avatar','دانشمند',12000,'avatars/scholar.svg',21),
('avatar_archer','avatar','کماندار',25000,'avatars/archer.svg',22),
('avatar_eagle','avatar','عقاب زرین',40000,'avatars/eagle.svg',23),
('avatar_lion','avatar','شیر پارسی',65000,'avatars/lion.svg',24),
('avatar_royal','avatar','شاهزاده افسانه‌ای',100000,'avatars/royal.svg',25)
on conflict(id) do update set kind=excluded.kind,display_name=excluded.display_name,price_coins=excluded.price_coins,asset_path=excluded.asset_path,sort_order=excluded.sort_order,is_active=true;
create or replace function public.baladi_equip_avatar(p_user_id uuid,p_avatar_id text)
returns jsonb language plpgsql set search_path=public,pg_temp as $$
declare v_profile public.baladi_game_profiles%rowtype;
begin
 if not exists(select 1 from public.baladi_cosmetic_catalog where id=p_avatar_id and kind='avatar' and is_active=true) then raise exception 'تصویر پروفایل انتخاب‌شده معتبر نیست.'; end if;
 if not exists(select 1 from public.baladi_user_cosmetics where user_id=p_user_id and cosmetic_id=p_avatar_id) then raise exception 'ابتدا باید این تصویر پروفایل را خریداری کنی.'; end if;
 update public.baladi_game_profiles set equipped_avatar_id=p_avatar_id,updated_at=now() where user_id=p_user_id returning * into v_profile;
 if not found then raise exception 'پروفایل بازی پیدا نشد.'; end if;
 return to_jsonb(v_profile);
end $$;
revoke all on function public.baladi_equip_avatar(uuid,text) from public,anon,authenticated;
grant execute on function public.baladi_equip_avatar(uuid,text) to service_role;
alter table public.baladi_game_events drop constraint if exists baladi_game_events_event_type_check;
alter table public.baladi_game_events add constraint baladi_game_events_event_type_check
 check (event_type = any (array[
 'level_completed','hint_used','word_found','bonus_word_found','daily_streak_reward',
 'hint_clue_used','monthly_leaderboard_reward','group_contribution','group_daily_reward'
 ]::text[]));
create or replace function public.baladi_group_contribute(p_user_id uuid,p_group_id uuid,p_amount integer)
returns jsonb language plpgsql set search_path=public,pg_temp as $$
declare v_group public.baladi_groups%rowtype; v_profile public.baladi_game_profiles%rowtype; v_target integer; v_progress integer; v_new_level integer; v_next_target integer;
begin
 if p_amount not between 1 and 1000000 then raise exception 'مبلغ مشارکت باید بین ۱ تا ۱٬۰۰۰٬۰۰۰ سکه باشد.'; end if;
 select * into v_group from public.baladi_groups where id=p_group_id for update;
 if not found then raise exception 'گروه پیدا نشد.'; end if;
 if not exists(select 1 from public.baladi_group_members where group_id=p_group_id and user_id=p_user_id) then raise exception 'فقط اعضای گروه می‌توانند مشارکت کنند.'; end if;
 if v_group.group_level>=3 then raise exception 'گروه به بالاترین سطح رسیده است.'; end if;
 select * into v_profile from public.baladi_game_profiles where user_id=p_user_id for update;
 if not found or v_profile.coins<p_amount then raise exception 'سکه کافی برای این مشارکت نداری.'; end if;
 v_progress := v_group.upgrade_progress+p_amount; v_new_level := v_group.group_level;
 while v_new_level<3 loop
  v_target := case when v_new_level=1 then 40000 else 200000 end;
  exit when v_progress<v_target;
  v_progress := v_progress-v_target; v_new_level := v_new_level+1;
 end loop;
 update public.baladi_game_profiles set coins=coins-p_amount,updated_at=now() where user_id=p_user_id returning * into v_profile;
 update public.baladi_groups set group_level=v_new_level,upgrade_progress=case when v_new_level=3 then 0 else v_progress end,updated_at=now() where id=p_group_id returning * into v_group;
 insert into public.baladi_game_events(user_id,event_type,event_key,coin_delta,metadata,created_at) values(p_user_id,'group_contribution',p_group_id::text,-p_amount,jsonb_build_object('group_id',p_group_id,'amount',p_amount,'new_level',v_new_level),now());
 v_next_target := case when v_new_level=1 then 40000 else 200000 end;
 return jsonb_build_object('group',to_jsonb(v_group),'profile',to_jsonb(v_profile),'contributed',p_amount,'next_target',v_next_target);
end $$;
revoke all on function public.baladi_group_contribute(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.baladi_group_contribute(uuid,uuid,integer) to service_role;
create table if not exists public.baladi_group_daily_claims(group_id uuid not null references public.baladi_groups(id) on delete cascade,user_id uuid not null references auth.users(id) on delete cascade,reward_date date not null,reward_coins integer not null check(reward_coins in (120,500)),claimed_at timestamptz not null default now(),primary key(group_id,user_id,reward_date));
alter table public.baladi_group_daily_claims enable row level security;
revoke all on public.baladi_group_daily_claims from anon,authenticated;
grant select,insert on public.baladi_group_daily_claims to service_role;
create or replace function public.baladi_claim_group_daily_reward(p_user_id uuid,p_group_id uuid)
returns jsonb language plpgsql set search_path=public,pg_temp as $$
declare v_group public.baladi_groups%rowtype; v_reward integer; v_today date := (now() at time zone 'Asia/Tehran')::date; v_profile public.baladi_game_profiles%rowtype;
begin
 select * into v_group from public.baladi_groups where id=p_group_id for update;
 if not found then raise exception 'گروه پیدا نشد.'; end if;
 if not exists(select 1 from public.baladi_group_members where group_id=p_group_id and user_id=p_user_id) then raise exception 'فقط اعضای گروه می‌توانند پاداش گروه را دریافت کنند.'; end if;
 v_reward := case v_group.group_level when 2 then 120 when 3 then 500 else 0 end;
 if v_reward=0 then raise exception 'پاداش روزانه از سطح دوم گروه فعال می‌شود.'; end if;
 insert into public.baladi_group_daily_claims(group_id,user_id,reward_date,reward_coins) values(p_group_id,p_user_id,v_today,v_reward) on conflict do nothing;
 if not found then raise exception 'پاداش امروز را قبلاً دریافت کرده‌ای.'; end if;
 update public.baladi_game_profiles set coins=coins+v_reward,updated_at=now() where user_id=p_user_id returning * into v_profile;
 insert into public.baladi_game_events(user_id,event_type,event_key,coin_delta,metadata,created_at) values(p_user_id,'group_daily_reward',p_group_id::text||':'||v_today::text,v_reward,jsonb_build_object('group_id',p_group_id,'reward_date',v_today,'group_level',v_group.group_level),now());
 return jsonb_build_object('reward_coins',v_reward,'profile',to_jsonb(v_profile),'reward_date',v_today);
end $$;
revoke all on function public.baladi_claim_group_daily_reward(uuid,uuid) from public,anon,authenticated;
grant execute on function public.baladi_claim_group_daily_reward(uuid,uuid) to service_role;
