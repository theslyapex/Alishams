-- Finalize duel matches after a one-second grace period.
-- Both players receive 20 XP for a draw (elapsed-time difference <= 1000ms).
-- Otherwise the winner receives 50 XP and the other player receives 5 XP.
create or replace function public.baladi_finalize_duel_match(p_match_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  m public.baladi_duel_matches%rowtype;
  p1 public.baladi_duel_progress%rowtype;
  p2 public.baladi_duel_progress%rowtype;
  w uuid;
  d boolean := false;
  x1 integer;
  x2 integer;
begin
  select * into m from public.baladi_duel_matches where id=p_match_id for update;
  if not found or m.status<>'active' then return jsonb_build_object('finalized',false); end if;
  select * into p1 from public.baladi_duel_progress where match_id=p_match_id and user_id=m.player_one for update;
  select * into p2 from public.baladi_duel_progress where match_id=p_match_id and user_id=m.player_two for update;
  if p1.completed_at is null and p2.completed_at is null then return jsonb_build_object('finalized',false); end if;
  if p1.completed_at is not null and p2.completed_at is not null then
    d := abs(p1.elapsed_ms-p2.elapsed_ms)<=1000;
    if not d then w := case when p1.elapsed_ms<p2.elapsed_ms then m.player_one else m.player_two end; end if;
  else
    if coalesce(p1.completed_at,p2.completed_at)>now()-interval '1 second' then
      return jsonb_build_object('finalized',false,'waiting',true);
    end if;
    w := case when p1.completed_at is not null then m.player_one else m.player_two end;
  end if;
  if d then x1:=20; x2:=20;
  elsif w=m.player_one then x1:=50; x2:=5;
  else x1:=5; x2:=50; end if;

  update public.baladi_duel_matches
  set status='completed',winner_id=w,finished_at=now(),
      elapsed_ms_one=case when p1.completed_at is not null then p1.elapsed_ms else elapsed_ms_one end,
      elapsed_ms_two=case when p2.completed_at is not null then p2.elapsed_ms else elapsed_ms_two end
  where id=p_match_id and status='active';

  update public.baladi_game_profiles
  set xp_total=least(499000,coalesce(xp_total,0)+x1),
      experience_level=least(500,(least(499000,coalesce(xp_total,0)+x1)/1000)+1),
      wins=wins+case when not d and w=m.player_one then 1 else 0 end,
      losses=losses+case when not d and w=m.player_two then 1 else 0 end,updated_at=now()
  where user_id=m.player_one;
  update public.baladi_game_profiles
  set xp_total=least(499000,coalesce(xp_total,0)+x2),
      experience_level=least(500,(least(499000,coalesce(xp_total,0)+x2)/1000)+1),
      wins=wins+case when not d and w=m.player_two then 1 else 0 end,
      losses=losses+case when not d and w=m.player_one then 1 else 0 end,updated_at=now()
  where user_id=m.player_two;
  return jsonb_build_object('finalized',true,'winner_id',w,'is_draw',d,'xp_player_one',x1,'xp_player_two',x2);
end; $$;

create or replace function public.baladi_duel_submit_word(p_user_id uuid,p_match_id uuid,p_word text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  m public.baladi_duel_matches%rowtype;
  p public.baladi_duel_progress%rowtype;
  r public.baladi_duel_rounds%rowtype;
  answer text;
  found_words text[];
  elapsed bigint;
  next_round smallint;
  final_result jsonb;
  reward integer:=0;
begin
  select * into m from public.baladi_duel_matches where id=p_match_id for update;
  if not found or m.status<>'active' then raise exception 'این مسابقه فعال نیست.'; end if;
  if p_user_id not in (m.player_one,m.player_two) then raise exception 'به این مسابقه دسترسی نداری.'; end if;
  final_result:=public.baladi_finalize_duel_match(p_match_id);
  if coalesce((final_result->>'finalized')::boolean,false) then raise exception 'این مسابقه به پایان رسیده است.'; end if;
  select * into p from public.baladi_duel_progress where match_id=p_match_id and user_id=p_user_id for update;
  if not found or p.completed_at is not null then raise exception 'پیشرفت این مسابقه قبلاً تمام شده است.'; end if;
  select * into r from public.baladi_duel_rounds where match_id=p_match_id and round_no=p.current_round;
  select t.answer into answer from unnest(r.answers) as t(answer)
  where public.baladi_normalize_persian_word(t.answer)=public.baladi_normalize_persian_word(p_word) limit 1;
  if answer is null then return jsonb_build_object('ok',true,'correct',false,'round_complete',false,'match_complete',false); end if;
  if answer=any(p.found_words) then
    return jsonb_build_object('ok',true,'correct',true,'already_found',true,'round_complete',false,'match_complete',false,'found_words',to_jsonb(p.found_words));
  end if;
  found_words:=array_append(p.found_words,answer);
  if cardinality(found_words)>=cardinality(r.answers) then
    if p.current_round=10 then
      elapsed:=floor(extract(epoch from(now()-p.started_at))*1000)::bigint;
      update public.baladi_duel_progress set found_words=found_words,completed_at=now(),elapsed_ms=elapsed
      where match_id=p_match_id and user_id=p_user_id;
      final_result:=public.baladi_finalize_duel_match(p_match_id);
      if coalesce((final_result->>'finalized')::boolean,false) then
        reward:=case when (final_result->>'is_draw')::boolean then 20 when final_result->>'winner_id'=p_user_id::text then 50 else 5 end;
        return jsonb_build_object('ok',true,'correct',true,'round_complete',true,'match_complete',true,
          'winner_id',final_result->>'winner_id','is_draw',coalesce((final_result->>'is_draw')::boolean,false),
          'elapsed_ms',elapsed,'xp_awarded',reward,'found_words',to_jsonb(found_words));
      end if;
      return jsonb_build_object('ok',true,'correct',true,'round_complete',true,'match_complete',false,
        'waiting_opponent',true,'elapsed_ms',elapsed,'found_words',to_jsonb(found_words));
    end if;
    next_round:=p.current_round+1;
    update public.baladi_duel_progress set current_round=next_round,found_words='{}',hinted_initials='{}',highlighted_letters='{}'
    where match_id=p_match_id and user_id=p_user_id;
    return jsonb_build_object('ok',true,'correct',true,'round_complete',true,'match_complete',false,'current_round',next_round,'found_words','[]'::jsonb);
  end if;
  update public.baladi_duel_progress set found_words=found_words where match_id=p_match_id and user_id=p_user_id;
  return jsonb_build_object('ok',true,'correct',true,'already_found',false,'round_complete',false,'match_complete',false,'found_words',to_jsonb(found_words));
end; $$;

create or replace function public.baladi_duel_state(p_user_id uuid,p_match_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  m public.baladi_duel_matches%rowtype;
  p public.baladi_duel_progress%rowtype;
  op public.baladi_duel_progress%rowtype;
  r public.baladi_duel_rounds%rowtype;
  opponent uuid;
  winner_time bigint;
  final_result jsonb;
begin
  select * into m from public.baladi_duel_matches where id=p_match_id for update;
  if not found then raise exception 'مسابقه پیدا نشد.'; end if;
  if p_user_id not in(m.player_one,m.player_two) then raise exception 'به این مسابقه دسترسی نداری.'; end if;
  final_result:=public.baladi_finalize_duel_match(p_match_id);
  select * into m from public.baladi_duel_matches where id=p_match_id;
  select * into p from public.baladi_duel_progress where match_id=p_match_id and user_id=p_user_id;
  opponent:=case when p_user_id=m.player_one then m.player_two else m.player_one end;
  select * into op from public.baladi_duel_progress where match_id=p_match_id and user_id=opponent;
  winner_time:=case when m.winner_id=m.player_one then m.elapsed_ms_one when m.winner_id=m.player_two then m.elapsed_ms_two else null end;
  select * into r from public.baladi_duel_rounds where match_id=p_match_id and round_no=p.current_round;
  return jsonb_build_object('match_id',p_match_id,'status',m.status,'winner_id',m.winner_id,
    'is_draw',m.status='completed' and m.winner_id is null,'opponent_id',opponent,
    'current_round',p.current_round,'round_count',10,'letters',coalesce(to_jsonb(r.letters),'[]'::jsonb),
    'answer_count',coalesce(cardinality(r.answers),0),'found_words',to_jsonb(p.found_words),
    'elapsed_ms',case when p.completed_at is null then floor(extract(epoch from(now()-p.started_at))*1000)::bigint else p.elapsed_ms end,
    'winner_elapsed_ms',winner_time,'hints_used',p.hints_used,'player_completed',p.completed_at is not null,
    'waiting_for_opponent',m.status='active' and p.completed_at is not null,'opponent_completed',op.completed_at is not null);
end; $$;

revoke all on function public.baladi_finalize_duel_match(uuid) from public,anon,authenticated;
revoke all on function public.baladi_duel_submit_word(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.baladi_duel_state(uuid,uuid) from public,anon,authenticated;
grant execute on function public.baladi_finalize_duel_match(uuid) to service_role;
grant execute on function public.baladi_duel_submit_word(uuid,uuid,text) to service_role;
grant execute on function public.baladi_duel_state(uuid,uuid) to service_role;