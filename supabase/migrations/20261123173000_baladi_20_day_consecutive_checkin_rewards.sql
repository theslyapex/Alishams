create or replace function public.baladi_daily_checkin(p_user_id uuid)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_profile public.baladi_game_profiles%rowtype;
  v_today date := (now() at time zone 'Asia/Tehran')::date;
  v_streak integer;
  v_cycle_day integer;
  v_reward integer := 0;
  v_next_day integer;
  v_next_reward integer := 0;
begin
  select * into v_profile
  from public.baladi_game_profiles
  where user_id = p_user_id
  for update;

  if not found then
    raise exception 'پروفایل بازی پیدا نشد.';
  end if;

  if v_profile.last_checkin_date = v_today then
    v_cycle_day := ((greatest(v_profile.daily_streak, 1) - 1) % 20) + 1;
    v_next_day := (v_cycle_day % 20) + 1;
    v_next_reward := case v_next_day
      when 1 then 20 when 4 then 80 when 6 then 180
      when 10 then 250 when 15 then 500 when 20 then 1000
      else 0 end;
    return jsonb_build_object(
      'profile', to_jsonb(v_profile), 'reward', 0,
      'already_checked_in', true, 'streak_day', v_profile.daily_streak,
      'cycle_day', v_cycle_day, 'next_reward', v_next_reward
    );
  end if;

  if v_profile.last_checkin_date = v_today - 1 then
    v_streak := v_profile.daily_streak + 1;
  else
    v_streak := 1;
  end if;

  v_cycle_day := ((v_streak - 1) % 20) + 1;
  v_reward := case v_cycle_day
    when 1 then 20
    when 4 then 80
    when 6 then 180
    when 10 then 250
    when 15 then 500
    when 20 then 1000
    else 0
  end;

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
      jsonb_build_object(
        'streak_days', v_streak,
        'cycle_day', v_cycle_day,
        'reward', v_reward,
        'timezone', 'Asia/Tehran'
      )
    )
    on conflict do nothing;
  end if;

  v_next_day := (v_cycle_day % 20) + 1;
  v_next_reward := case v_next_day
    when 1 then 20 when 4 then 80 when 6 then 180
    when 10 then 250 when 15 then 500 when 20 then 1000
    else 0 end;

  return jsonb_build_object(
    'profile', to_jsonb(v_profile),
    'reward', v_reward,
    'already_checked_in', false,
    'streak_day', v_streak,
    'cycle_day', v_cycle_day,
    'next_reward', v_next_reward
  );
end;
$$;

revoke all on function public.baladi_daily_checkin(uuid) from public, anon, authenticated;
grant execute on function public.baladi_daily_checkin(uuid) to service_role;