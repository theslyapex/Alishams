alter table public.baladi_game_profiles
  add column if not exists display_name text,
  add column if not exists daily_streak integer not null default 0,
  add column if not exists last_checkin_date date;

create or replace function public.baladi_daily_checkin(p_user_id uuid)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_profile public.baladi_game_profiles%rowtype;
  v_today date := (now() at time zone 'UTC')::date;
  v_streak integer;
  v_reward integer := 0;
begin
  select * into v_profile
  from public.baladi_game_profiles
  where user_id = p_user_id
  for update;

  if not found then
    raise exception 'پروفایل بازی پیدا نشد.';
  end if;

  if v_profile.last_checkin_date = v_today then
    return jsonb_build_object('profile', to_jsonb(v_profile), 'reward', 0, 'already_checked_in', true);
  end if;

  if v_profile.last_checkin_date = v_today - 1 then
    v_streak := v_profile.daily_streak + 1;
  else
    v_streak := 1;
  end if;

  if v_streak > 0 and mod(v_streak, 7) = 0 then
    v_reward := 50;
  end if;

  update public.baladi_game_profiles
  set daily_streak = v_streak,
      last_checkin_date = v_today,
      coins = coins + v_reward,
      updated_at = now()
  where user_id = p_user_id
  returning * into v_profile;

  if v_reward > 0 then
    insert into public.baladi_game_events(user_id, event_type, event_key, coin_delta, metadata)
    values (
      p_user_id,
      'daily_streak_reward',
      'daily-streak:' || v_today::text,
      v_reward,
      jsonb_build_object('streak_days', v_streak, 'reward', v_reward)
    )
    on conflict do nothing;
  end if;

  return jsonb_build_object('profile', to_jsonb(v_profile), 'reward', v_reward, 'already_checked_in', false);
end;
$$;

create or replace function public.baladi_spend_clue(
  p_user_id uuid,
  p_session_id uuid,
  p_level integer,
  p_hint_type text
)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_cost integer;
  v_profile public.baladi_game_profiles%rowtype;
begin
  v_cost := case p_hint_type
    when 'first_letter' then 8
    when 'word_length' then 5
    when 'highlight_letter' then 12
    else null
  end;

  if v_cost is null then raise exception 'نوع راهنما معتبر نیست.'; end if;
  if not exists (
    select 1 from public.baladi_game_sessions
    where id = p_session_id and user_id = p_user_id and ended_at is null
  ) then raise exception 'نشست فعال بازی پیدا نشد.'; end if;

  select * into v_profile
  from public.baladi_game_profiles
  where user_id = p_user_id
  for update;

  if not found or v_profile.current_level <> p_level then
    raise exception 'این مرحله در حساب شما فعال نیست.';
  end if;
  if v_profile.coins < v_cost then raise exception 'سکه کافی برای این راهنما نداری.'; end if;

  update public.baladi_game_profiles
  set coins = coins - v_cost,
      hints_used = hints_used + 1,
      updated_at = now()
  where user_id = p_user_id
  returning * into v_profile;

  insert into public.baladi_game_events(user_id, session_id, event_type, level_number, coin_delta, metadata)
  values (
    p_user_id, p_session_id, 'hint_clue_used', p_level, -v_cost,
    jsonb_build_object('hint_type', p_hint_type, 'cost', v_cost)
  );

  return jsonb_build_object('profile', to_jsonb(v_profile), 'cost', v_cost, 'hint_type', p_hint_type);
end;
$$;

revoke all on function public.baladi_daily_checkin(uuid) from public, anon, authenticated;
grant execute on function public.baladi_daily_checkin(uuid) to service_role;
revoke all on function public.baladi_spend_clue(uuid, uuid, integer, text) from public, anon, authenticated;
grant execute on function public.baladi_spend_clue(uuid, uuid, integer, text) to service_role;
