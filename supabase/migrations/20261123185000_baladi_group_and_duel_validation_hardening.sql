create or replace function public.baladi_upgrade_group_capacity(p_user_id uuid,p_group_id uuid,p_new_capacity integer)
returns jsonb
language plpgsql
set search_path=public,pg_temp
as $$
declare
  v_group public.baladi_groups%rowtype;
  v_profile public.baladi_game_profiles%rowtype;
  v_blocks integer;
  v_cost integer;
begin
  select * into v_group from public.baladi_groups where id=p_group_id for update;
  if not found then raise exception 'گروه پیدا نشد.'; end if;
  if v_group.leader_id <> p_user_id then raise exception 'فقط رهبر گروه می‌تواند ظرفیت را افزایش دهد.'; end if;
  if p_new_capacity <= v_group.capacity or p_new_capacity % 5 <> 0 then
    raise exception 'ظرفیت جدید باید حداقل ۵ نفر بیشتر و مضربی از ۵ باشد.';
  end if;
  v_blocks := (p_new_capacity-v_group.capacity)/5;
  v_cost := v_blocks*50000;
  select * into v_profile from public.baladi_game_profiles where user_id=p_user_id for update;
  if not found then raise exception 'پروفایل بازی پیدا نشد.'; end if;
  if v_profile.coins < v_cost then raise exception 'برای افزایش ظرفیت به % سکه نیاز داری.',v_cost; end if;
  update public.baladi_game_profiles set coins=coins-v_cost,updated_at=now() where user_id=p_user_id returning * into v_profile;
  update public.baladi_groups set capacity=p_new_capacity,updated_at=now() where id=p_group_id returning * into v_group;
  return jsonb_build_object('group',to_jsonb(v_group),'profile',to_jsonb(v_profile),'cost',v_cost);
end;
$$;

create or replace function public.baladi_send_duel_invite(p_sender_id uuid,p_recipient_id uuid)
returns jsonb
language plpgsql
set search_path=public,pg_temp
as $$
declare
  v_invite public.baladi_duel_invites%rowtype;
begin
  if p_sender_id=p_recipient_id then raise exception 'نمی‌توانی خودت را به مسابقه دعوت کنی.'; end if;
  if not exists(select 1 from public.baladi_game_profiles where user_id=p_sender_id) then
    raise exception 'پروفایل فرستنده پیدا نشد.';
  end if;
  if not exists(select 1 from public.baladi_game_profiles where user_id=p_recipient_id) then
    raise exception 'پروفایل بازیکن پیدا نشد.';
  end if;
  if exists(select 1 from public.baladi_duel_matches where status='active' and (player_one in (p_sender_id,p_recipient_id) or player_two in (p_sender_id,p_recipient_id))) then
    raise exception 'یکی از بازیکنان در حال حاضر مسابقه فعال دارد.';
  end if;
  update public.baladi_duel_invites set status='expired'
  where status='pending' and expires_at < now();
  insert into public.baladi_duel_invites(sender_id,recipient_id)
  values(p_sender_id,p_recipient_id)
  returning * into v_invite;
  return jsonb_build_object('invite_id',v_invite.id,'status',v_invite.status,'expires_at',v_invite.expires_at);
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
  if not found then raise exception 'پروفایل بازی پیدا نشد.'; end if;
  if v_profile.coins<v_cost then raise exception 'برای این راهنمای مسابقه به % سکه نیاز داری.',v_cost; end if;

  if p_hint_type='first_letter' then
    select t.answer into v_answer
    from unnest(v_round.answers) as t(answer)
    where not (t.answer=any(v_progress.found_words))
      and not (left(t.answer,1)=any(v_progress.hinted_initials))
    order by t.answer limit 1;
    if v_answer is null then raise exception 'حرف اول همه پاسخ‌های باقی‌مانده را قبلاً دیده‌ای.'; end if;
    v_clue := left(v_answer,1);
    update public.baladi_duel_progress set hinted_initials=array_append(hinted_initials,v_clue)
    where match_id=p_match_id and user_id=p_user_id;
  elsif p_hint_type='highlight_letter' then
    select chars.character into v_clue
    from unnest(v_round.answers) as answers(answer)
    cross join lateral regexp_split_to_table(answers.answer,'') as chars(character)
    where not (answers.answer=any(v_progress.found_words))
      and not (chars.character=any(v_progress.highlighted_letters))
    order by random() limit 1;
    if v_clue is null then raise exception 'همه حروف قابل برجسته‌سازی را قبلاً دیده‌ای.'; end if;
    update public.baladi_duel_progress set highlighted_letters=array_append(highlighted_letters,v_clue)
    where match_id=p_match_id and user_id=p_user_id;
  else
    select t.answer into v_answer
    from unnest(v_round.answers) as t(answer)
    where not (t.answer=any(v_progress.found_words))
    order by t.answer limit 1;
    if v_answer is null then raise exception 'در این مرحله پاسخ حل‌نشده‌ای باقی نمانده است.'; end if;
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