create table if not exists public.baladi_game_hint_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  level_number integer not null,
  hint_type text not null check (hint_type in ('first_letter','highlight_letter')),
  clue_key text not null check (char_length(clue_key) between 1 and 4),
  used_at timestamptz not null default now(),
  primary key(user_id,level_number,hint_type,clue_key)
);
alter table public.baladi_game_hint_usage enable row level security;

create or replace function public.baladi_spend_clue(
  p_user_id uuid,
  p_session_id uuid,
  p_level integer,
  p_hint_type text,
  p_clue_key text
)
returns jsonb
language plpgsql
set search_path=public,pg_temp
as $$
declare
  v_cost integer;
  v_profile public.baladi_game_profiles%rowtype;
  v_inserted integer;
  v_key text := public.baladi_normalize_persian_word(p_clue_key);
begin
  v_cost := case p_hint_type
    when 'first_letter' then 8
    when 'highlight_letter' then 12
    else null
  end;
  if v_cost is null then raise exception 'نوع راهنما معتبر نیست.'; end if;
  if v_key is null or char_length(v_key)<1 or char_length(v_key)>4 then
    raise exception 'شناسه حرف راهنما معتبر نیست.';
  end if;
  if not exists (
    select 1 from public.baladi_game_sessions
    where id=p_session_id and user_id=p_user_id and ended_at is null
  ) then raise exception 'نشست فعال بازی پیدا نشد.'; end if;

  select * into v_profile
  from public.baladi_game_profiles
  where user_id=p_user_id
  for update;
  if not found or v_profile.current_level<>p_level then
    raise exception 'این مرحله در حساب شما فعال نیست.';
  end if;
  if v_profile.coins<v_cost then raise exception 'سکه کافی برای این راهنما نداری.'; end if;

  insert into public.baladi_game_hint_usage(user_id,level_number,hint_type,clue_key)
  values(p_user_id,p_level,p_hint_type,v_key)
  on conflict do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted=0 then
    raise exception 'این راهنما را برای این حرف قبلاً استفاده کرده‌ای.';
  end if;

  update public.baladi_game_profiles
  set coins=coins-v_cost,hints_used=hints_used+1,updated_at=now()
  where user_id=p_user_id
  returning * into v_profile;

  insert into public.baladi_game_events(user_id,session_id,event_type,level_number,coin_delta,metadata)
  values(p_user_id,p_session_id,'hint_clue_used',p_level,-v_cost,
    jsonb_build_object('hint_type',p_hint_type,'cost',v_cost,'clue_key',v_key));

  return jsonb_build_object('profile',to_jsonb(v_profile),'cost',v_cost,'hint_type',p_hint_type);
end;
$$;

revoke all on function public.baladi_spend_clue(uuid,uuid,integer,text,text) from public,anon,authenticated;
grant execute on function public.baladi_spend_clue(uuid,uuid,integer,text,text) to service_role;