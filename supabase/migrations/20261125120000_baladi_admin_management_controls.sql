alter table public.baladi_game_profiles
  add column if not exists is_suspended boolean not null default false,
  add column if not exists suspension_reason text not null default '';

alter table public.baladi_game_events
  drop constraint if exists baladi_game_events_event_type_check;
alter table public.baladi_game_events
  add constraint baladi_game_events_event_type_check
  check (event_type = any (array[
    'level_completed','hint_used','word_found','bonus_word_found',
    'daily_streak_reward','hint_clue_used','monthly_leaderboard_reward',
    'group_contribution','group_daily_reward','chapter_diamond_reward',
    'admin_coin_adjustment'
  ]));

create or replace function public.baladi_admin_adjust_coins(
  p_user_id uuid,
  p_delta integer,
  p_reason text default ''
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_profile public.baladi_game_profiles%rowtype;
begin
  if p_user_id is null or p_delta = 0 or abs(p_delta) > 10000000 then
    raise exception 'مقدار تغییر سکه معتبر نیست.';
  end if;
  update public.baladi_game_profiles
     set coins = coins + p_delta,
         updated_at = now()
   where user_id = p_user_id
     and coins + p_delta >= 0
  returning * into v_profile;
  if not found then
    raise exception 'حساب بازی پیدا نشد یا موجودی برای کسر سکه کافی نیست.';
  end if;
  insert into public.baladi_game_events(user_id,event_type,event_key,coin_delta,metadata)
  values (
    p_user_id,
    'admin_coin_adjustment',
    'admin:' || gen_random_uuid()::text,
    p_delta,
    jsonb_build_object('reason',left(coalesce(p_reason,''),500),'admin_adjustment',true)
  );
  return jsonb_build_object('ok',true,'user_id',p_user_id,'coins',v_profile.coins,'delta',p_delta);
end;
$$;
revoke all on function public.baladi_admin_adjust_coins(uuid,integer,text) from public, anon, authenticated;
grant execute on function public.baladi_admin_adjust_coins(uuid,integer,text) to service_role;
