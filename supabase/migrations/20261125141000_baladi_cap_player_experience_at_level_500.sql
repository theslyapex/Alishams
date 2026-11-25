-- XP is capped at 499,000 total points, which is level 500.
-- Word and stage rewards remain atomic and idempotent.
create or replace function public.baladi_complete_level(p_user_id uuid, p_level integer, p_session_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
declare
  v_profile public.baladi_game_profiles%rowtype;
  v_catalog public.baladi_game_level_catalog%rowtype;
  v_found integer;
  v_diamond_reward integer := 0;
  v_xp_reward integer := 20;
begin
  if p_level < 1 or p_level > 10000 then raise exception 'شماره مرحله معتبر نیست.'; end if;
  select * into v_catalog from public.baladi_game_level_catalog where level_number = p_level and is_active;
  if not found then raise exception 'اطلاعات این مرحله در سرور ثبت نشده است.'; end if;
  insert into public.baladi_game_profiles(user_id) values (p_user_id) on conflict (user_id) do nothing;
  select * into v_profile from public.baladi_game_profiles where user_id = p_user_id for update;
  if p_level < v_profile.current_level then return to_jsonb(v_profile); end if;
  if p_level <> v_profile.current_level then raise exception 'ابتدا باید مرحله قبلی را تکمیل کنی.'; end if;
  if not exists (select 1 from public.baladi_game_sessions where id = p_session_id and user_id = p_user_id and ended_at is null) then raise exception 'نشست فعال بازی پیدا نشد.'; end if;
  select count(distinct event_key) into v_found from public.baladi_game_events where user_id = p_user_id and event_type = 'word_found' and level_number = p_level;
  if v_found < cardinality(v_catalog.answers) then raise exception 'هنوز همه واژه‌های این مرحله ثبت نشده‌اند.'; end if;
  v_diamond_reward := case when p_level % 20 = 0 then 1 else 0 end;
  v_xp_reward := least(20, greatest(0, 499000 - v_profile.xp_total));
  update public.baladi_game_profiles set coins=coins+v_catalog.reward_coins, diamonds=diamonds+v_diamond_reward,
    current_level=current_level+1, completed_levels=array_append(completed_levels,p_level),
    levels_completed=levels_completed+1, xp_total=xp_total+v_xp_reward,
    experience_level=least(500,greatest(1,floor((xp_total+v_xp_reward)::numeric/1000)::integer+1)), updated_at=now()
    where user_id=p_user_id returning * into v_profile;
  insert into public.baladi_game_events(user_id,session_id,event_type,level_number,coin_delta,metadata)
    values(p_user_id,p_session_id,'level_completed',p_level,v_catalog.reward_coins,
      jsonb_build_object('reward_source','server','reward',v_catalog.reward_coins,'diamonds_awarded',v_diamond_reward,'xp_awarded',v_xp_reward));
  if v_diamond_reward > 0 then
    insert into public.baladi_game_events(user_id,event_type,event_key,level_number,metadata)
      values(p_user_id,'chapter_diamond_reward','chapter-diamond:'||(p_level/20)::text,p_level,
        jsonb_build_object('chapter',p_level/20,'diamonds',1)) on conflict do nothing;
  end if;
  return to_jsonb(v_profile);
end;
$function$;

create or replace function public.baladi_record_word_reward(
  p_user_id uuid,p_session_id uuid,p_level integer,p_event_type text,p_event_key text,p_word text,p_coin_reward integer
)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp'
as $function$
declare
  v_profile public.baladi_game_profiles%rowtype;
  v_inserted integer := 0;
  v_xp_reward integer := 5;
begin
  if p_event_type not in ('word_found','bonus_word_found') or p_coin_reward not in (3,7) or p_level<1
     or length(coalesce(p_word,''))<2 or length(coalesce(p_word,''))>24 then raise exception 'اطلاعات پاداش واژه معتبر نیست.'; end if;
  if not exists(select 1 from public.baladi_game_sessions where id=p_session_id and user_id=p_user_id and ended_at is null) then raise exception 'نشست فعال بازی پیدا نشد.'; end if;
  insert into public.baladi_game_profiles(user_id) values(p_user_id) on conflict(user_id) do nothing;
  select * into v_profile from public.baladi_game_profiles where user_id=p_user_id for update;
  if v_profile.current_level<>p_level then raise exception 'این مرحله در حساب شما فعال نیست.'; end if;
  v_xp_reward := least(5,greatest(0,499000-v_profile.xp_total));
  insert into public.baladi_game_events(user_id,session_id,event_type,event_key,level_number,coin_delta,metadata)
    values(p_user_id,p_session_id,p_event_type,p_event_key,p_level,p_coin_reward,
      jsonb_build_object('word',p_word,'source',case when p_event_type='word_found' then 'answer' else 'dictionary_bonus' end,'xp_awarded',v_xp_reward))
    on conflict do nothing;
  get diagnostics v_inserted=row_count;
  if v_inserted=0 then return jsonb_build_object('ok',true,'already_found',true,'coins_awarded',0,'xp_awarded',0,'profile',to_jsonb(v_profile)); end if;
  update public.baladi_game_profiles set words_found=words_found+1,
    bonus_words_found=bonus_words_found+case when p_event_type='bonus_word_found' then 1 else 0 end,
    coins=coins+p_coin_reward,xp_total=xp_total+v_xp_reward,
    experience_level=least(500,greatest(1,floor((xp_total+v_xp_reward)::numeric/1000)::integer+1)),updated_at=now()
    where user_id=p_user_id returning * into v_profile;
  return jsonb_build_object('ok',true,'already_found',false,'coins_awarded',p_coin_reward,'xp_awarded',v_xp_reward,'profile',to_jsonb(v_profile));
end;
$function$;
