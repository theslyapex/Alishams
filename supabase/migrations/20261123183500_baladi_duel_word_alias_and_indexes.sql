create or replace function public.baladi_duel_submit_word(p_user_id uuid,p_match_id uuid,p_word text)
returns jsonb
language plpgsql
set search_path=public,pg_temp
as $$
declare
  v_match public.baladi_duel_matches%rowtype;
  v_progress public.baladi_duel_progress%rowtype;
  v_round public.baladi_duel_rounds%rowtype;
  v_word text;
  v_found text[];
  v_elapsed bigint;
  v_next_round smallint;
begin
  select * into v_match from public.baladi_duel_matches where id=p_match_id for update;
  if not found or v_match.status<>'active' then raise exception 'این مسابقه فعال نیست.'; end if;
  if p_user_id not in (v_match.player_one,v_match.player_two) then raise exception 'به این مسابقه دسترسی نداری.'; end if;
  select * into v_progress from public.baladi_duel_progress where match_id=p_match_id and user_id=p_user_id for update;
  if not found or v_progress.completed_at is not null then raise exception 'پیشرفت این مسابقه قبلاً تمام شده است.'; end if;
  select * into v_round from public.baladi_duel_rounds where match_id=p_match_id and round_no=v_progress.current_round;
  select t.answer into v_word
  from unnest(v_round.answers) as t(answer)
  where public.baladi_normalize_persian_word(t.answer)=public.baladi_normalize_persian_word(p_word)
  limit 1;
  if v_word is null then
    return jsonb_build_object('ok',true,'correct',false,'round_complete',false,'match_complete',false);
  end if;
  if v_word=any(v_progress.found_words) then
    return jsonb_build_object('ok',true,'correct',true,'already_found',true,'round_complete',false,'match_complete',false,'found_words',to_jsonb(v_progress.found_words));
  end if;
  v_found := array_append(v_progress.found_words,v_word);

  if cardinality(v_found)>=cardinality(v_round.answers) then
    v_next_round := v_progress.current_round + 1;
    if v_progress.current_round=10 then
      v_elapsed := floor(extract(epoch from (now()-v_progress.started_at))*1000)::bigint;
      update public.baladi_duel_progress set found_words=v_found,completed_at=now(),elapsed_ms=v_elapsed
      where match_id=p_match_id and user_id=p_user_id;
      update public.baladi_duel_matches
      set status='completed',winner_id=p_user_id,finished_at=now(),
          elapsed_ms_one=case when player_one=p_user_id then v_elapsed else elapsed_ms_one end,
          elapsed_ms_two=case when player_two=p_user_id then v_elapsed else elapsed_ms_two end
      where id=p_match_id and status='active';
      update public.baladi_game_profiles set wins=wins+1,updated_at=now() where user_id=p_user_id;
      update public.baladi_game_profiles set losses=losses+1,updated_at=now()
      where user_id=case when v_match.player_one=p_user_id then v_match.player_two else v_match.player_one end;
      return jsonb_build_object('ok',true,'correct',true,'round_complete',true,'match_complete',true,'winner_id',p_user_id,'elapsed_ms',v_elapsed,'found_words',to_jsonb(v_found));
    else
      update public.baladi_duel_progress set current_round=v_next_round,found_words='{}'
      where match_id=p_match_id and user_id=p_user_id;
      return jsonb_build_object('ok',true,'correct',true,'round_complete',true,'match_complete',false,'current_round',v_next_round,'found_words','[]'::jsonb);
    end if;
  end if;

  update public.baladi_duel_progress set found_words=v_found
  where match_id=p_match_id and user_id=p_user_id;
  return jsonb_build_object('ok',true,'correct',true,'already_found',false,'round_complete',false,'match_complete',false,'found_words',to_jsonb(v_found));
end;
$$;

create or replace function public.baladi_duel_spend_hint(p_user_id uuid,p_match_id uuid,p_hint_type text)
returns jsonb
language plpgsql
set search_path=public,pg_temp
as $$
declare
  v_match public.baladi_duel_matches%rowtype;
  v_progress public.baladi_duel_progress%rowtype;
  v_round public.baladi_duel_rounds%rowtype;
  v_profile public.baladi_game_profiles%rowtype;
  v_cost integer;
  v_answer text;
  v_clue text;
  v_result jsonb;
begin
  v_cost := case p_hint_type when 'first_letter' then 24 when 'highlight_letter' then 36 when 'reveal_word' then 60 else 0 end;
  if v_cost=0 then raise exception 'نوع راهنما معتبر نیست.'; end if;
  select * into v_match from public.baladi_duel_matches where id=p_match_id for update;
  if not found or v_match.status<>'active' or p_user_id not in (v_match.player_one,v_match.player_two) then
    raise exception 'مسابقه فعال یا دسترسی معتبر نیست.';
  end if;
  select * into v_progress from public.baladi_duel_progress where match_id=p_match_id and user_id=p_user_id for update;
  select * into v_round from public.baladi_duel_rounds where match_id=p_match_id and round_no=v_progress.current_round;
  select * into v_profile from public.baladi_game_profiles where user_id=p_user_id for update;
  if not found or v_profile.coins<v_cost then raise exception 'برای این راهنمای مسابقه به %s سکه نیاز داری.',v_cost; end if;
  select t.answer into v_answer
  from unnest(v_round.answers) as t(answer)
  where not (t.answer=any(v_progress.found_words))
  order by t.answer
  limit 1;
  if v_answer is null then raise exception 'در این مرحله پاسخ حل‌نشده‌ای باقی نمانده است.'; end if;

  if p_hint_type='first_letter' then
    v_clue := left(v_answer,1);
  elsif p_hint_type='highlight_letter' then
    select t.character into v_clue
    from regexp_split_to_table(v_answer,'') as t(character)
    order by random() limit 1;
  else
    v_clue := v_answer;
  end if;

  update public.baladi_game_profiles
  set coins=coins-v_cost,hints_used=hints_used+1,updated_at=now()
  where user_id=p_user_id;

  if p_hint_type='reveal_word' then
    v_result := public.baladi_duel_submit_word(p_user_id,p_match_id,v_answer);
  else
    v_result := jsonb_build_object('ok',true);
  end if;

  update public.baladi_duel_progress
  set hints_used=hints_used+1
  where match_id=p_match_id and user_id=p_user_id;

  return jsonb_build_object('ok',true,'hint_type',p_hint_type,'clue',v_clue,'cost',v_cost,'result',v_result);
end;
$$;

create index if not exists baladi_duel_matches_player_two_idx on public.baladi_duel_matches(player_two,status);
create index if not exists baladi_duel_matches_winner_idx on public.baladi_duel_matches(winner_id);
create index if not exists baladi_duel_invites_sender_idx on public.baladi_duel_invites(sender_id,status,created_at desc);