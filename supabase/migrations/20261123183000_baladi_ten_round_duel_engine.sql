create or replace function public.baladi_normalize_persian_word(p_word text)
returns text
language sql
immutable
set search_path=public,pg_temp
as $$
  select replace(replace(replace(replace(btrim(coalesce(p_word,'')),'ي','ی'),'ك','ک'),'‌',''),'ـ','')
$$;

create table if not exists public.baladi_duel_matches (
  id uuid primary key default gen_random_uuid(),
  player_one uuid not null references auth.users(id) on delete cascade,
  player_two uuid not null references auth.users(id) on delete cascade,
  status text not null default 'active' check (status in ('active','completed','cancelled')),
  winner_id uuid references auth.users(id),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  elapsed_ms_one bigint,
  elapsed_ms_two bigint,
  created_at timestamptz not null default now(),
  constraint baladi_duel_distinct_players check (player_one <> player_two)
);

create table if not exists public.baladi_duel_invites (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  match_id uuid references public.baladi_duel_matches(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','accepted','declined','expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  constraint baladi_duel_invite_distinct_users check (sender_id <> recipient_id)
);
create unique index if not exists baladi_duel_invites_pending_pair_uidx
  on public.baladi_duel_invites(sender_id,recipient_id) where status='pending';
create index if not exists baladi_duel_invites_recipient_idx
  on public.baladi_duel_invites(recipient_id,status,created_at desc);

create table if not exists public.baladi_duel_rounds (
  match_id uuid not null references public.baladi_duel_matches(id) on delete cascade,
  round_no smallint not null check (round_no between 1 and 10),
  level_number integer not null,
  letters text[] not null,
  answers text[] not null,
  primary key(match_id,round_no)
);

create table if not exists public.baladi_duel_progress (
  match_id uuid not null references public.baladi_duel_matches(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  current_round smallint not null default 1 check (current_round between 1 and 10),
  found_words text[] not null default '{}',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  elapsed_ms bigint,
  hints_used integer not null default 0,
  primary key(match_id,user_id)
);
create index if not exists baladi_duel_matches_players_idx
  on public.baladi_duel_matches(player_one,player_two,status);
create index if not exists baladi_duel_progress_user_idx
  on public.baladi_duel_progress(user_id,started_at desc);

alter table public.baladi_duel_matches enable row level security;
alter table public.baladi_duel_invites enable row level security;
alter table public.baladi_duel_rounds enable row level security;
alter table public.baladi_duel_progress enable row level security;

create or replace function public.baladi_send_duel_invite(p_sender_id uuid,p_recipient_id uuid)
returns jsonb
language plpgsql
set search_path=public,pg_temp
as $$
declare
  v_invite public.baladi_duel_invites%rowtype;
begin
  if p_sender_id=p_recipient_id then raise exception 'نمی‌توانی خودت را به مسابقه دعوت کنی.'; end if;
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

create or replace function public.baladi_accept_duel_invite(p_user_id uuid,p_invite_id uuid)
returns jsonb
language plpgsql
set search_path=public,pg_temp
as $$
declare
  v_invite public.baladi_duel_invites%rowtype;
  v_match public.baladi_duel_matches%rowtype;
  v_level record;
  v_round smallint := 0;
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
  if (select count(*) from public.baladi_game_level_catalog where is_active=true)<10 then
    raise exception 'برای شروع مسابقه، حداقل ۱۰ مرحله فعال لازم است.';
  end if;

  insert into public.baladi_duel_matches(player_one,player_two,status)
  values(v_invite.sender_id,p_user_id,'active')
  returning * into v_match;

  for v_level in
    select level_number,letters,answers
    from public.baladi_game_level_catalog
    where is_active=true
    order by random()
    limit 10
  loop
    v_round := v_round + 1;
    insert into public.baladi_duel_rounds(match_id,round_no,level_number,letters,answers)
    values(v_match.id,v_round,v_level.level_number,v_level.letters,v_level.answers);
  end loop;

  insert into public.baladi_duel_progress(match_id,user_id,current_round,started_at)
  values(v_match.id,v_invite.sender_id,1,now()),(v_match.id,p_user_id,1,now());

  update public.baladi_duel_invites
  set status='accepted',match_id=v_match.id
  where id=p_invite_id;

  return jsonb_build_object('ok',true,'match_id',v_match.id,'round_count',10,'status','active');
end;
$$;

create or replace function public.baladi_decline_duel_invite(p_user_id uuid,p_invite_id uuid)
returns jsonb
language plpgsql
set search_path=public,pg_temp
as $$
begin
  update public.baladi_duel_invites
  set status='declined'
  where id=p_invite_id and recipient_id=p_user_id and status='pending';
  if not found then raise exception 'درخواست مسابقه فعال پیدا نشد.'; end if;
  return jsonb_build_object('ok',true);
end;
$$;

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
begin
  select * into v_match from public.baladi_duel_matches where id=p_match_id;
  if not found then raise exception 'مسابقه پیدا نشد.'; end if;
  if p_user_id not in (v_match.player_one,v_match.player_two) then raise exception 'به این مسابقه دسترسی نداری.'; end if;
  select * into v_progress from public.baladi_duel_progress where match_id=p_match_id and user_id=p_user_id;
  if not found then raise exception 'وضعیت بازیکن در مسابقه پیدا نشد.'; end if;
  v_opponent := case when p_user_id=v_match.player_one then v_match.player_two else v_match.player_one end;
  select * into v_round from public.baladi_duel_rounds where match_id=p_match_id and round_no=v_progress.current_round;
  return jsonb_build_object(
    'match_id',p_match_id,'status',v_match.status,'winner_id',v_match.winner_id,
    'opponent_id',v_opponent,'current_round',v_progress.current_round,
    'round_count',10,'letters',coalesce(to_jsonb(v_round.letters),'[]'::jsonb),
    'answer_count',coalesce(cardinality(v_round.answers),0),
    'found_words',to_jsonb(v_progress.found_words),
    'elapsed_ms',case when v_progress.completed_at is null then floor(extract(epoch from (now()-v_progress.started_at))*1000)::bigint else v_progress.elapsed_ms end,
    'hints_used',v_progress.hints_used
  );
end;
$$;

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
  v_word := null;
  select answer into v_word
  from unnest(v_round.answers) as answer
  where public.baladi_normalize_persian_word(answer)=public.baladi_normalize_persian_word(p_word)
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
      where user_id=case when player_one=p_user_id then player_two else player_one end;
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
  select answer into v_answer
  from unnest(v_round.answers) as answer
  where not (answer=any(v_progress.found_words))
  order by answer
  limit 1;
  if v_answer is null then raise exception 'در این مرحله پاسخ حل‌نشده‌ای باقی نمانده است.'; end if;

  if p_hint_type='first_letter' then
    v_clue := left(v_answer,1);
  elsif p_hint_type='highlight_letter' then
    select character into v_clue
    from regexp_split_to_table(v_answer,'') as character
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

revoke all on function public.baladi_send_duel_invite(uuid,uuid) from public,anon,authenticated;
grant execute on function public.baladi_send_duel_invite(uuid,uuid) to service_role;
revoke all on function public.baladi_accept_duel_invite(uuid,uuid) from public,anon,authenticated;
grant execute on function public.baladi_accept_duel_invite(uuid,uuid) to service_role;
revoke all on function public.baladi_decline_duel_invite(uuid,uuid) from public,anon,authenticated;
grant execute on function public.baladi_decline_duel_invite(uuid,uuid) to service_role;
revoke all on function public.baladi_duel_state(uuid,uuid) from public,anon,authenticated;
grant execute on function public.baladi_duel_state(uuid,uuid) to service_role;
revoke all on function public.baladi_duel_submit_word(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.baladi_duel_submit_word(uuid,uuid,text) to service_role;
revoke all on function public.baladi_duel_spend_hint(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.baladi_duel_spend_hint(uuid,uuid,text) to service_role;