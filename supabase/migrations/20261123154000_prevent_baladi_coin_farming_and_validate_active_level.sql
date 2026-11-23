drop index if exists public.baladi_game_events_unique_word_per_session;
create unique index if not exists baladi_game_events_unique_word_per_user
on public.baladi_game_events(user_id,event_type,event_key)
where event_type='word_found' and event_key is not null;

create or replace function public.baladi_complete_level(p_user_id uuid,p_level integer,p_session_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_profile public.baladi_game_profiles%rowtype; v_catalog public.baladi_game_level_catalog%rowtype; v_found integer;
begin
  if p_level<1 or p_level>10000 then raise exception 'شماره مرحله معتبر نیست.'; end if;
  select * into v_catalog from public.baladi_game_level_catalog where level_number=p_level and is_active;
  if not found then raise exception 'اطلاعات این مرحله در سرور ثبت نشده است.'; end if;
  insert into public.baladi_game_profiles(user_id) values(p_user_id) on conflict(user_id) do nothing;
  select * into v_profile from public.baladi_game_profiles where user_id=p_user_id for update;
  if p_level<v_profile.current_level then return to_jsonb(v_profile); end if;
  if p_level<>v_profile.current_level then raise exception 'ابتدا باید مرحله قبلی را تکمیل کنی.'; end if;
  if not exists(select 1 from public.baladi_game_sessions where id=p_session_id and user_id=p_user_id and ended_at is null) then raise exception 'نشست فعال بازی پیدا نشد.'; end if;
  select count(distinct event_key) into v_found from public.baladi_game_events
  where user_id=p_user_id and event_type='word_found' and level_number=p_level;
  if v_found<cardinality(v_catalog.answers) then raise exception 'هنوز همه واژه‌های این مرحله ثبت نشده‌اند.'; end if;
  update public.baladi_game_profiles set coins=coins+v_catalog.reward_coins,current_level=current_level+1,
    completed_levels=array_append(completed_levels,p_level),levels_completed=levels_completed+1,updated_at=now()
  where user_id=p_user_id returning * into v_profile;
  insert into public.baladi_game_events(user_id,session_id,event_type,level_number,coin_delta,metadata)
  values(p_user_id,p_session_id,'level_completed',p_level,v_catalog.reward_coins,jsonb_build_object('reward_source','server','reward',v_catalog.reward_coins));
  return to_jsonb(v_profile);
end; $$;

create or replace function public.baladi_spend_hint(p_user_id uuid,p_session_id uuid,p_level integer,p_word text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_profile public.baladi_game_profiles%rowtype; v_catalog public.baladi_game_level_catalog%rowtype; v_word text:=normalize(trim(p_word),NFC);
begin
  if p_level<1 or char_length(v_word)<2 or char_length(v_word)>24 then raise exception 'اطلاعات راهنما معتبر نیست.'; end if;
  if not exists(select 1 from public.baladi_game_sessions where id=p_session_id and user_id=p_user_id and ended_at is null) then raise exception 'نشست فعال بازی پیدا نشد.'; end if;
  select * into v_catalog from public.baladi_game_level_catalog where level_number=p_level and is_active;
  if not found or not (v_word=any(v_catalog.answers)) then raise exception 'واژه راهنما در فهرست پاسخ‌های این مرحله نیست.'; end if;
  select * into v_profile from public.baladi_game_profiles where user_id=p_user_id for update;
  if not found or v_profile.coins<20 then raise exception 'سکه کافی برای استفاده از راهنما نداری.'; end if;
  if p_level<>v_profile.current_level then raise exception 'این مرحله در حساب شما فعال نیست.'; end if;
  insert into public.baladi_game_events(user_id,session_id,event_type,event_key,level_number,metadata)
  values(p_user_id,p_session_id,'word_found',p_level::text||':'||v_word,p_level,jsonb_build_object('word',v_word,'source','hint')) on conflict do nothing;
  if not found then raise exception 'این واژه قبلاً در حساب شما ثبت شده است.'; end if;
  update public.baladi_game_profiles set coins=coins-20,hints_used=hints_used+1,updated_at=now()
  where user_id=p_user_id returning * into v_profile;
  insert into public.baladi_game_events(user_id,session_id,event_type,level_number,coin_delta,metadata)
  values(p_user_id,p_session_id,'hint_used',p_level,-20,jsonb_build_object('cost',20,'word',v_word));
  return to_jsonb(v_profile);
end; $$;
revoke all on function public.baladi_complete_level(uuid,integer,uuid) from public,anon,authenticated;
revoke all on function public.baladi_spend_hint(uuid,uuid,integer,text) from public,anon,authenticated;
grant execute on function public.baladi_complete_level(uuid,integer,uuid) to service_role;
grant execute on function public.baladi_spend_hint(uuid,uuid,integer,text) to service_role;
