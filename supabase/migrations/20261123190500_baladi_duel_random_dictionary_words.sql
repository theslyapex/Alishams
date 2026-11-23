create or replace function public.baladi_accept_duel_invite(p_user_id uuid,p_invite_id uuid)
returns jsonb
language plpgsql
set search_path=public,pg_temp
as $$
declare
  v_invite public.baladi_duel_invites%rowtype;
  v_match public.baladi_duel_matches%rowtype;
  v_word text;
  v_letters text[];
  v_used_words text[] := '{}';
  v_round smallint;
begin
  select * into v_invite from public.baladi_duel_invites where id=p_invite_id for update;
  if not found then raise exception 'درخواست مسابقه پیدا نشد.'; end if;
  if v_invite.recipient_id<>p_user_id then raise exception 'این درخواست برای حساب تو نیست.'; end if;
  if v_invite.status<>'pending' then raise exception 'این درخواست دیگر فعال نیست.'; end if;
  if v_invite.expires_at<now() then
    update public.baladi_duel_invites set status='expired' where id=p_invite_id;
    raise exception 'مهلت این درخواست تمام شده است.';
  end if;
  if exists(select 1 from public.baladi_duel_matches where status='active' and (player_one in (v_invite.sender_id,p_user_id) or player_two in (v_invite.sender_id,p_user_id))) then
    raise exception 'یکی از بازیکنان در حال حاضر مسابقه فعال دارد.';
  end if;
  if (select count(*) from public.baladi_game_dictionary
      where char_length(public.baladi_normalize_persian_word(word)) between 3 and 6
        and word !~ '[[:space:]]'
        and position('‌' in word)=0
        and position('ـ' in word)=0) < 10 then
    raise exception 'برای مسابقه، حداقل ۱۰ واژه معتبر در واژه‌نامه لازم است.';
  end if;

  insert into public.baladi_duel_matches(player_one,player_two,status)
  values(v_invite.sender_id,p_user_id,'active')
  returning * into v_match;

  for v_round in 1..10 loop
    select word into v_word
    from public.baladi_game_dictionary
    where char_length(public.baladi_normalize_persian_word(word)) between 3 and 6
      and word !~ '[[:space:]]'
      and position('‌' in word)=0
      and position('ـ' in word)=0
      and not (word=any(v_used_words))
    order by random()
    limit 1;
    if v_word is null then raise exception 'انتخاب واژه تصادفی برای مسابقه ناموفق بود.'; end if;
    v_used_words := array_append(v_used_words,v_word);
    v_letters := regexp_split_to_array(public.baladi_normalize_persian_word(v_word),'');
    insert into public.baladi_duel_rounds(match_id,round_no,level_number,letters,answers)
    values(v_match.id,v_round,v_round,v_letters,array[public.baladi_normalize_persian_word(v_word)]);
  end loop;

  insert into public.baladi_duel_progress(match_id,user_id,current_round,started_at)
  values(v_match.id,v_invite.sender_id,1,now()),(v_match.id,p_user_id,1,now());

  update public.baladi_duel_invites
  set status='accepted',match_id=v_match.id
  where id=p_invite_id;

  return jsonb_build_object('ok',true,'match_id',v_match.id,'round_count',10,'status','active');
end;
$$;