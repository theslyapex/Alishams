create table if not exists public.baladi_game_level_catalog (
  level_number integer primary key check (level_number >= 1),
  answers text[] not null,
  reward_coins integer not null check (reward_coins >= 0),
  is_active boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.baladi_game_level_catalog enable row level security;
revoke all on public.baladi_game_level_catalog from anon, authenticated;
grant all on public.baladi_game_level_catalog to service_role;
insert into public.baladi_game_level_catalog(level_number, answers, reward_coins, is_active)
values
(1, ARRAY['باد','سبد','ادب' ]::text[], 25, true),
(2, ARRAY['مادر','مرد','دام','رام' ]::text[], 30, true),
(3, ARRAY['کتاب','تاب','تاک' ]::text[], 35, true),
(4, ARRAY['خانه','خاک','خان','نخ' ]::text[], 40, true),
(5, ARRAY['دوست','سود','دود' ]::text[], 45, true),
(6, ARRAY['گلاب','بلا','بال','لب' ]::text[], 45, true),
(7, ARRAY['پرستو','سرو','تور','پوست' ]::text[], 50, true),
(8, ARRAY['نور','روز','زر','زور' ]::text[], 50, true),
(9, ARRAY['مهربان','مهر','بهار','نهر','رام' ]::text[], 55, true),
(10, ARRAY['آباد','آبی','یاد','باد' ]::text[], 55, true),
(11, ARRAY['فرهنگ','هنر','رنگ','نهر','فر' ]::text[], 60, true),
(12, ARRAY['شکوه','کوه','هوش','شو' ]::text[], 60, true),
(13, ARRAY['دانش','دان','ندا','شاد' ]::text[], 65, true),
(14, ARRAY['باران','بار','ناب','ران','نار' ]::text[], 65, true),
(15, ARRAY['ستاره','ستار','راه','سه','تار' ]::text[], 70, true),
(16, ARRAY['کرامت','کرم','کار','متر','ترک' ]::text[], 70, true),
(17, ARRAY['پیروز','روز','زیر','پیر','زور' ]::text[], 75, true),
(18, ARRAY['آزادی','آزاد','یاد' ]::text[], 75, true),
(19, ARRAY['سرمایه','سر','ماه','مهر','راه' ]::text[], 80, true),
(20, ARRAY['جهان','جان','نه','هان' ]::text[], 85, true)
on conflict (level_number) do update
set answers=excluded.answers,reward_coins=excluded.reward_coins,is_active=excluded.is_active,updated_at=now();

create or replace function public.baladi_complete_level(p_user_id uuid, p_level integer, p_session_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_profile public.baladi_game_profiles%rowtype; v_catalog public.baladi_game_level_catalog%rowtype; v_found integer;
begin
  if p_level < 1 or p_level > 10000 then raise exception 'شماره مرحله معتبر نیست.'; end if;
  select * into v_catalog from public.baladi_game_level_catalog where level_number=p_level and is_active;
  if not found then raise exception 'اطلاعات این مرحله در سرور ثبت نشده است.'; end if;
  insert into public.baladi_game_profiles(user_id) values (p_user_id) on conflict (user_id) do nothing;
  select * into v_profile from public.baladi_game_profiles where user_id=p_user_id for update;
  if p_level < v_profile.current_level then return to_jsonb(v_profile); end if;
  if p_level <> v_profile.current_level then raise exception 'ابتدا باید مرحله قبلی را تکمیل کنی.'; end if;
  if not exists(select 1 from public.baladi_game_sessions where id=p_session_id and user_id=p_user_id and ended_at is null) then raise exception 'نشست فعال بازی پیدا نشد.'; end if;
  select count(distinct event_key) into v_found from public.baladi_game_events
  where user_id=p_user_id and session_id=p_session_id and event_type='word_found' and level_number=p_level;
  if v_found < cardinality(v_catalog.answers) then raise exception 'هنوز همه واژه‌های این مرحله ثبت نشده‌اند.'; end if;
  update public.baladi_game_profiles set coins=coins+v_catalog.reward_coins,current_level=current_level+1,
    completed_levels=array_append(completed_levels,p_level),levels_completed=levels_completed+1,updated_at=now()
  where user_id=p_user_id returning * into v_profile;
  insert into public.baladi_game_events(user_id,session_id,event_type,level_number,coin_delta,metadata)
  values(p_user_id,p_session_id,'level_completed',p_level,v_catalog.reward_coins,jsonb_build_object('reward_source','server','reward',v_catalog.reward_coins));
  return to_jsonb(v_profile);
end; $$;
revoke all on function public.baladi_complete_level(uuid,integer,uuid) from public,anon,authenticated;
grant execute on function public.baladi_complete_level(uuid,integer,uuid) to service_role;
