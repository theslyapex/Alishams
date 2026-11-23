create table if not exists public.baladi_game_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  coins integer not null default 100 check (coins >= 0),
  current_level integer not null default 1 check (current_level >= 1),
  completed_levels integer[] not null default '{}',
  levels_completed integer not null default 0 check (levels_completed >= 0),
  total_play_seconds bigint not null default 0 check (total_play_seconds >= 0),
  sessions_count integer not null default 0 check (sessions_count >= 0),
  words_found integer not null default 0 check (words_found >= 0),
  hints_used integer not null default 0 check (hints_used >= 0),
  last_played_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.baladi_game_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  last_ping_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_seconds integer not null default 0 check (duration_seconds >= 0),
  start_level integer not null default 1,
  end_level integer not null default 1,
  device_platform text not null default 'android' check (device_platform in ('android','web','other')),
  created_at timestamptz not null default now()
);
create index if not exists baladi_game_sessions_user_started_idx on public.baladi_game_sessions(user_id, started_at desc);

create table if not exists public.baladi_game_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid references public.baladi_game_sessions(id) on delete set null,
  event_type text not null check (event_type in ('level_completed','hint_used','word_found')),
  event_key text,
  level_number integer,
  coin_delta integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists baladi_game_events_user_created_idx on public.baladi_game_events(user_id, created_at desc);
create unique index if not exists baladi_game_events_unique_word_per_session
  on public.baladi_game_events(session_id, event_type, event_key)
  where event_type = 'word_found' and session_id is not null;

alter table public.baladi_game_profiles enable row level security;
alter table public.baladi_game_sessions enable row level security;
alter table public.baladi_game_events enable row level security;
revoke all on public.baladi_game_profiles from anon, authenticated;
revoke all on public.baladi_game_sessions from anon, authenticated;
revoke all on public.baladi_game_events from anon, authenticated;
grant all on public.baladi_game_profiles to service_role;
grant all on public.baladi_game_sessions to service_role;
grant all on public.baladi_game_events to service_role;

create or replace function public.baladi_touch_session(p_session_id uuid, p_user_id uuid, p_close boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_session public.baladi_game_sessions%rowtype; v_delta integer; v_profile public.baladi_game_profiles%rowtype;
begin
  select * into v_session from public.baladi_game_sessions
  where id = p_session_id and user_id = p_user_id for update;
  if not found then raise exception 'جلسه بازی پیدا نشد.'; end if;
  if v_session.ended_at is not null then
    select * into v_profile from public.baladi_game_profiles where user_id = p_user_id;
    return to_jsonb(v_profile);
  end if;
  v_delta := greatest(0, least(120, floor(extract(epoch from (now() - v_session.last_ping_at)))::integer));
  update public.baladi_game_sessions
  set duration_seconds = duration_seconds + v_delta, last_ping_at = now(),
      ended_at = case when p_close then now() else null end
  where id = p_session_id;
  insert into public.baladi_game_profiles(user_id, total_play_seconds, last_played_at, updated_at)
  values (p_user_id, v_delta, now(), now())
  on conflict (user_id) do update
  set total_play_seconds = public.baladi_game_profiles.total_play_seconds + v_delta,
      last_played_at = now(), updated_at = now()
  returning * into v_profile;
  return to_jsonb(v_profile);
end; $$;

create or replace function public.baladi_complete_level(p_user_id uuid, p_level integer)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_profile public.baladi_game_profiles%rowtype;
begin
  if p_level < 1 or p_level > 10000 then raise exception 'شماره مرحله معتبر نیست.'; end if;
  insert into public.baladi_game_profiles(user_id) values (p_user_id) on conflict (user_id) do nothing;
  select * into v_profile from public.baladi_game_profiles where user_id = p_user_id for update;
  if p_level < v_profile.current_level then return to_jsonb(v_profile); end if;
  if p_level <> v_profile.current_level then raise exception 'ابتدا باید مرحله قبلی را تکمیل کنی.'; end if;
  update public.baladi_game_profiles
  set coins = coins + 15, current_level = current_level + 1,
      completed_levels = array_append(completed_levels, p_level),
      levels_completed = levels_completed + 1, updated_at = now()
  where user_id = p_user_id returning * into v_profile;
  insert into public.baladi_game_events(user_id, event_type, level_number, coin_delta, metadata)
  values (p_user_id, 'level_completed', p_level, 15, jsonb_build_object('reward_source','server'));
  return to_jsonb(v_profile);
end; $$;

create or replace function public.baladi_spend_hint(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_profile public.baladi_game_profiles%rowtype;
begin
  update public.baladi_game_profiles
  set coins = coins - 20, hints_used = hints_used + 1, updated_at = now()
  where user_id = p_user_id and coins >= 20 returning * into v_profile;
  if not found then raise exception 'سکه کافی برای استفاده از راهنما نداری.'; end if;
  insert into public.baladi_game_events(user_id, event_type, coin_delta, metadata)
  values (p_user_id, 'hint_used', -20, jsonb_build_object('cost',20));
  return to_jsonb(v_profile);
end; $$;

revoke all on function public.baladi_touch_session(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.baladi_complete_level(uuid, integer) from public, anon, authenticated;
revoke all on function public.baladi_spend_hint(uuid) from public, anon, authenticated;
grant execute on function public.baladi_touch_session(uuid, uuid, boolean) to service_role;
grant execute on function public.baladi_complete_level(uuid, integer) to service_role;
grant execute on function public.baladi_spend_hint(uuid) to service_role;
