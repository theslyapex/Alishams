create or replace function public.baladi_record_word_reward(
  p_user_id uuid,
  p_session_id uuid,
  p_level integer,
  p_event_type text,
  p_event_key text,
  p_word text,
  p_coin_reward integer
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_profile public.baladi_game_profiles%rowtype;
  v_inserted integer := 0;
  v_xp_reward integer := 5;
begin
  if p_event_type not in ('word_found', 'bonus_word_found')
     or p_coin_reward not in (3, 7)
     or p_level < 1
     or length(coalesce(p_word, '')) < 2
     or length(coalesce(p_word, '')) > 24 then
    raise exception 'اطلاعات پاداش واژه معتبر نیست.';
  end if;
  if not exists (
    select 1 from public.baladi_game_sessions
    where id = p_session_id and user_id = p_user_id and ended_at is null
  ) then
    raise exception 'نشست فعال بازی پیدا نشد.';
  end if;
  insert into public.baladi_game_profiles(user_id)
    values (p_user_id) on conflict (user_id) do nothing;
  select * into v_profile from public.baladi_game_profiles
    where user_id = p_user_id for update;
  if v_profile.current_level <> p_level then
    raise exception 'این مرحله در حساب شما فعال نیست.';
  end if;
  insert into public.baladi_game_events(
    user_id, session_id, event_type, event_key, level_number, coin_delta, metadata
  ) values (
    p_user_id, p_session_id, p_event_type, p_event_key, p_level, p_coin_reward,
    jsonb_build_object(
      'word', p_word,
      'source', case when p_event_type = 'word_found' then 'answer' else 'dictionary_bonus' end,
      'xp_awarded', v_xp_reward
    )
  ) on conflict do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return jsonb_build_object(
      'ok', true, 'already_found', true, 'coins_awarded', 0, 'xp_awarded', 0,
      'profile', to_jsonb(v_profile)
    );
  end if;
  update public.baladi_game_profiles
    set words_found = words_found + 1,
        bonus_words_found = bonus_words_found + case when p_event_type = 'bonus_word_found' then 1 else 0 end,
        coins = coins + p_coin_reward,
        xp_total = xp_total + v_xp_reward,
        experience_level = least(500, greatest(1, floor((xp_total + v_xp_reward)::numeric / 1000)::integer + 1)),
        updated_at = now()
    where user_id = p_user_id returning * into v_profile;
  return jsonb_build_object(
    'ok', true, 'already_found', false, 'coins_awarded', p_coin_reward,
    'xp_awarded', v_xp_reward, 'profile', to_jsonb(v_profile)
  );
end;
$function$;
revoke all on function public.baladi_record_word_reward(uuid, uuid, integer, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.baladi_record_word_reward(uuid, uuid, integer, text, text, text, integer) to service_role;
