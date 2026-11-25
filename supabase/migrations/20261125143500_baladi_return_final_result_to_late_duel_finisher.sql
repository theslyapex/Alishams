CREATE OR REPLACE FUNCTION public.baladi_duel_submit_word(p_user_id uuid, p_match_id uuid, p_word text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_match public.baladi_duel_matches%rowtype;
  v_progress public.baladi_duel_progress%rowtype;
  v_opponent public.baladi_duel_progress%rowtype;
  v_round public.baladi_duel_rounds%rowtype;
  v_word text;
  v_found text[];
  v_elapsed bigint;
  v_next_round smallint;
  v_final jsonb;
  v_xp integer := 0;
begin
  select * into v_match from public.baladi_duel_matches where id=p_match_id for update;
  if not found or v_match.status<>'active' then raise exception 'این مسابقه فعال نیست.'; end if;
  if p_user_id not in (v_match.player_one,v_match.player_two) then raise exception 'به این مسابقه دسترسی نداری.'; end if;

  v_final := public.baladi_finalize_duel_match(p_match_id);
  if coalesce((v_final->>'finalized')::boolean,false) then
    v_xp := case when coalesce((v_final->>'is_draw')::boolean,false) then 20
      when v_final->>'winner_id'=p_user_id::text then 50 else 5 end;
    return jsonb_build_object('ok',true,'correct',false,'round_complete',false,'match_complete',true,
      'winner_id',v_final->>'winner_id','is_draw',coalesce((v_final->>'is_draw')::boolean,false),
      'elapsed_ms',coalesce((select case when v_final->>'winner_id'=v_match.player_one::text then elapsed_ms_one else elapsed_ms_two end from public.baladi_duel_matches where id=p_match_id),0),
      'xp_awarded',v_xp,'late_finish',true);
  end if;

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
    if v_progress.current_round=10 then
      v_elapsed := floor(extract(epoch from (now()-v_progress.started_at))*1000)::bigint;
      update public.baladi_duel_progress set found_words=v_found,completed_at=now(),elapsed_ms=v_elapsed
      where match_id=p_match_id and user_id=p_user_id;
      select * into v_opponent from public.baladi_duel_progress
      where match_id=p_match_id and user_id=case when p_user_id=v_match.player_one then v_match.player_two else v_match.player_one end;
      v_final := public.baladi_finalize_duel_match(p_match_id);
      if coalesce((v_final->>'finalized')::boolean,false) then
        v_xp := case when (v_final->>'is_draw')::boolean then 20
          when v_final->>'winner_id'=p_user_id::text then 50 else 5 end;
        return jsonb_build_object('ok',true,'correct',true,'round_complete',true,'match_complete',true,
          'winner_id',v_final->>'winner_id','is_draw',coalesce((v_final->>'is_draw')::boolean,false),
          'elapsed_ms',v_elapsed,'xp_awarded',v_xp,'found_words',to_jsonb(v_found));
      end if;
      return jsonb_build_object('ok',true,'correct',true,'round_complete',true,'match_complete',false,
        'waiting_opponent',true,'elapsed_ms',v_elapsed,'found_words',to_jsonb(v_found));
    else
      v_next_round := v_progress.current_round + 1;
      update public.baladi_duel_progress
      set current_round=v_next_round,found_words='{}',hinted_initials='{}',highlighted_letters='{}'
      where match_id=p_match_id and user_id=p_user_id;
      return jsonb_build_object('ok',true,'correct',true,'round_complete',true,'match_complete',false,'current_round',v_next_round,'found_words','[]'::jsonb);
    end if;
  end if;

  update public.baladi_duel_progress set found_words=v_found where match_id=p_match_id and user_id=p_user_id;
  return jsonb_build_object('ok',true,'correct',true,'already_found',false,'round_complete',false,'match_complete',false,'found_words',to_jsonb(v_found));
end;
$function$;
revoke all on function public.baladi_duel_submit_word(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.baladi_duel_submit_word(uuid,uuid,text) to service_role;
