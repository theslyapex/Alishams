create or replace function public.baladi_spend_hint(p_user_id uuid,p_session_id uuid,p_level integer,p_word text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_profile public.baladi_game_profiles%rowtype; v_catalog public.baladi_game_level_catalog%rowtype; v_word text := normalize(trim(p_word), NFC);
begin
  if p_level<1 or char_length(v_word)<2 or char_length(v_word)>24 then raise exception 'اطلاعات راهنما معتبر نیست.'; end if;
  if not exists(select 1 from public.baladi_game_sessions where id=p_session_id and user_id=p_user_id and ended_at is null) then raise exception 'نشست فعال بازی پیدا نشد.'; end if;
  select * into v_catalog from public.baladi_game_level_catalog where level_number=p_level and is_active;
  if not found or not (v_word=any(v_catalog.answers)) then raise exception 'واژه راهنما در فهرست پاسخ‌های این مرحله نیست.'; end if;
  select * into v_profile from public.baladi_game_profiles where user_id=p_user_id for update;
  if not found or v_profile.coins<20 then raise exception 'سکه کافی برای استفاده از راهنما نداری.'; end if;
  insert into public.baladi_game_events(user_id,session_id,event_type,event_key,level_number,metadata)
  values(p_user_id,p_session_id,'word_found',p_level::text||':'||v_word,p_level,jsonb_build_object('word',v_word,'source','hint')) on conflict do nothing;
  if not found then raise exception 'این واژه قبلاً در این نشست ثبت شده است.'; end if;
  update public.baladi_game_profiles set coins=coins-20,hints_used=hints_used+1,updated_at=now()
  where user_id=p_user_id returning * into v_profile;
  insert into public.baladi_game_events(user_id,session_id,event_type,level_number,coin_delta,metadata)
  values(p_user_id,p_session_id,'hint_used',p_level,-20,jsonb_build_object('cost',20,'word',v_word));
  return to_jsonb(v_profile);
end; $$;
revoke all on function public.baladi_spend_hint(uuid) from public,anon,authenticated;
revoke all on function public.baladi_spend_hint(uuid,uuid,integer,text) from public,anon,authenticated;
grant execute on function public.baladi_spend_hint(uuid,uuid,integer,text) to service_role;
