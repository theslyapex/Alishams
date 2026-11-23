alter table public.baladi_game_profiles
  add column if not exists diamonds integer not null default 0 check (diamonds >= 0),
  add column if not exists name_change_count integer not null default 0 check (name_change_count >= 0);

update public.baladi_game_profiles set name_change_count=1 where name_change_count=0 and display_name is not null and length(trim(display_name))>0;

create or replace function public.baladi_change_display_name(p_user_id uuid, p_display_name text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_profile public.baladi_game_profiles%rowtype;
  v_name text := normalize(trim(coalesce(p_display_name,'')), NFC);
  v_spent integer := 0;
begin
  if p_user_id is null then raise exception 'حساب کاربری معتبر نیست.'; end if;
  if char_length(v_name) < 2 or char_length(v_name) > 24 or v_name ~ '[[:cntrl:]]' then
    raise exception 'نام نمایشی باید بین ۲ تا ۲۴ نویسه باشد.';
  end if;
  select * into v_profile from public.baladi_game_profiles where user_id = p_user_id for update;
  if not found then raise exception 'پروفایل بازی پیدا نشد.'; end if;
  if v_profile.display_name is not distinct from v_name then
    return jsonb_build_object('profile',to_jsonb(v_profile),'diamonds_spent',0);
  end if;
  if v_profile.name_change_count >= 1 then
    if v_profile.diamonds < 1 then raise exception 'برای تغییر دوباره نام، یک الماس لازم داری.'; end if;
    v_spent := 1;
    update public.baladi_game_profiles set diamonds = diamonds - 1, display_name = v_name,
      name_change_count = name_change_count + 1, updated_at = now()
      where user_id = p_user_id returning * into v_profile;
    insert into public.baladi_game_events(user_id,event_type,event_key,metadata)
      values (p_user_id,'name_changed','name-change:' || gen_random_uuid()::text,
        jsonb_build_object('cost_diamonds',1,'name',v_name));
  else
    update public.baladi_game_profiles set display_name = v_name, name_change_count = 1, updated_at = now()
      where user_id = p_user_id returning * into v_profile;
  end if;
  return jsonb_build_object('profile',to_jsonb(v_profile),'diamonds_spent',v_spent);
end;
$$;
revoke all on function public.baladi_change_display_name(uuid,text) from public, anon, authenticated;
grant execute on function public.baladi_change_display_name(uuid,text) to service_role;

create or replace function public.baladi_complete_level(p_user_id uuid, p_level integer, p_session_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_profile public.baladi_game_profiles%rowtype;
  v_catalog public.baladi_game_level_catalog%rowtype;
  v_found integer;
  v_diamond_reward integer := 0;
begin
  if p_level < 1 or p_level > 10000 then raise exception 'شماره مرحله معتبر نیست.'; end if;
  select * into v_catalog from public.baladi_game_level_catalog where level_number = p_level and is_active;
  if not found then raise exception 'اطلاعات این مرحله در سرور ثبت نشده است.'; end if;
  insert into public.baladi_game_profiles(user_id) values (p_user_id) on conflict (user_id) do nothing;
  select * into v_profile from public.baladi_game_profiles where user_id = p_user_id for update;
  if p_level < v_profile.current_level then return to_jsonb(v_profile); end if;
  if p_level <> v_profile.current_level then raise exception 'ابتدا باید مرحله قبلی را تکمیل کنی.'; end if;
  if not exists (select 1 from public.baladi_game_sessions where id = p_session_id and user_id = p_user_id and ended_at is null) then
    raise exception 'نشست فعال بازی پیدا نشد.';
  end if;
  select count(distinct event_key) into v_found from public.baladi_game_events
    where user_id = p_user_id and event_type = 'word_found' and level_number = p_level;
  if v_found < cardinality(v_catalog.answers) then raise exception 'هنوز همه واژه‌های این مرحله ثبت نشده‌اند.'; end if;
  v_diamond_reward := case when p_level % 20 = 0 then 1 else 0 end;
  update public.baladi_game_profiles set coins = coins + v_catalog.reward_coins,
    diamonds = diamonds + v_diamond_reward, current_level = current_level + 1,
    completed_levels = array_append(completed_levels, p_level),
    levels_completed = levels_completed + 1, updated_at = now()
    where user_id = p_user_id returning * into v_profile;
  insert into public.baladi_game_events(user_id, session_id, event_type, level_number, coin_delta, metadata)
    values (p_user_id, p_session_id, 'level_completed', p_level, v_catalog.reward_coins,
      jsonb_build_object('reward_source','server','reward',v_catalog.reward_coins,'diamonds_awarded',v_diamond_reward));
  if v_diamond_reward > 0 then
    insert into public.baladi_game_events(user_id,event_type,event_key,level_number,metadata)
      values (p_user_id,'chapter_diamond_reward','chapter-diamond:' || (p_level / 20)::text,p_level,
        jsonb_build_object('chapter',p_level / 20,'diamonds',1)) on conflict do nothing;
  end if;
  return to_jsonb(v_profile);
end;
$$;
revoke all on function public.baladi_change_display_name(uuid,text) from public, anon, authenticated;
grant execute on function public.baladi_change_display_name(uuid,text) to service_role;