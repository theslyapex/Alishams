create or replace function public.baladi_duel_state(p_user_id uuid,p_match_id uuid)
returns jsonb
language plpgsql
set search_path=public,pg_temp
as $$
declare
  v_match public.baladi_duel_matches%rowtype;
  v_progress public.baladi_duel_progress%rowtype;
  v_round public.baladi_duel_rounds%rowtype;
  v_opponent uuid;
  v_winner_elapsed bigint;
begin
  select * into v_match from public.baladi_duel_matches where id=p_match_id;
  if not found then raise exception 'مسابقه پیدا نشد.'; end if;
  if p_user_id not in (v_match.player_one,v_match.player_two) then raise exception 'به این مسابقه دسترسی نداری.'; end if;
  select * into v_progress from public.baladi_duel_progress where match_id=p_match_id and user_id=p_user_id;
  if not found then raise exception 'وضعیت بازیکن در مسابقه پیدا نشد.'; end if;
  v_opponent := case when p_user_id=v_match.player_one then v_match.player_two else v_match.player_one end;
  v_winner_elapsed := case when v_match.winner_id=v_match.player_one then v_match.elapsed_ms_one when v_match.winner_id=v_match.player_two then v_match.elapsed_ms_two else null end;
  select * into v_round from public.baladi_duel_rounds where match_id=p_match_id and round_no=v_progress.current_round;
  return jsonb_build_object(
    'match_id',p_match_id,'status',v_match.status,'winner_id',v_match.winner_id,
    'opponent_id',v_opponent,'current_round',v_progress.current_round,
    'round_count',10,'letters',coalesce(to_jsonb(v_round.letters),'[]'::jsonb),
    'answer_count',coalesce(cardinality(v_round.answers),0),
    'found_words',to_jsonb(v_progress.found_words),
    'elapsed_ms',case when v_progress.completed_at is null then floor(extract(epoch from (now()-v_progress.started_at))*1000)::bigint else v_progress.elapsed_ms end,
    'winner_elapsed_ms',v_winner_elapsed,
    'hints_used',v_progress.hints_used
  );
end;
$$;