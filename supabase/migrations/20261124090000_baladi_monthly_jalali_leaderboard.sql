-- Jalali monthly leaderboard with one-time monthly coin awards.
create table if not exists public.baladi_monthly_leaderboard (
  month_key text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null default 'بازیکن',
  valid_words integer not null default 0,
  highest_level integer not null default 0,
  coins_earned bigint not null default 0,
  duel_wins integer not null default 0,
  tie_break_at timestamptz,
  rank integer not null check (rank > 0),
  reward_coins integer not null default 0 check (reward_coins >= 0),
  rewarded_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (month_key,user_id)
);
alter table public.baladi_monthly_leaderboard enable row level security;
revoke all on public.baladi_monthly_leaderboard from anon,authenticated;
grant select,insert,update on public.baladi_monthly_leaderboard to service_role;

alter table public.baladi_game_events drop constraint if exists baladi_game_events_event_type_check;
alter table public.baladi_game_events add constraint baladi_game_events_event_type_check
check (event_type = any(array[
  'level_completed','hint_used','word_found','bonus_word_found',
  'daily_streak_reward','hint_clue_used','monthly_leaderboard_reward'
]::text[]));

create or replace function public.baladi_monthly_stats(p_start_at timestamptz,p_end_at timestamptz,p_limit integer default 100)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
with event_stats as (
 select e.user_id,
   count(*) filter(where e.event_type in ('word_found','bonus_word_found'))::integer valid_words,
   coalesce(max(e.level_number) filter(where e.event_type='level_completed'),0)::integer highest_level,
   coalesce(sum(greatest(e.coin_delta,0)) filter(where e.event_type<>'monthly_leaderboard_reward'),0)::bigint coins_earned,
   max(e.created_at) last_event_at
 from public.baladi_game_events e
 where e.created_at>=p_start_at and e.created_at<p_end_at
 group by e.user_id
), duel_stats as (
 select m.winner_id user_id,count(*)::integer duel_wins,max(m.finished_at) last_win_at
 from public.baladi_duel_matches m
 where m.status='completed' and m.winner_id is not null
   and m.finished_at>=p_start_at and m.finished_at<p_end_at
 group by m.winner_id
), combined as (
 select p.user_id,coalesce(nullif(btrim(p.display_name),''),'بازیکن') display_name,
   coalesce(e.valid_words,0) valid_words,coalesce(e.highest_level,0) highest_level,
   coalesce(e.coins_earned,0) coins_earned,coalesce(d.duel_wins,0) duel_wins,
   greatest(e.last_event_at,d.last_win_at) tie_break_at,coalesce(p.is_verified,false) is_verified
 from public.baladi_game_profiles p
 left join event_stats e on e.user_id=p.user_id
 left join duel_stats d on d.user_id=p.user_id
 where coalesce(e.valid_words,0)>0 or coalesce(e.highest_level,0)>0
   or coalesce(e.coins_earned,0)>0 or coalesce(d.duel_wins,0)>0
), ranked as (
 select row_number() over(order by valid_words desc,highest_level desc,coins_earned desc,
   duel_wins desc,tie_break_at asc nulls last,user_id asc)::integer rank,*
 from combined
)
select jsonb_build_object('leaderboard',coalesce((
 select jsonb_agg(jsonb_build_object(
   'rank',rank,'user_id',user_id,'display_name',display_name,
   'valid_words',valid_words,'highest_level',highest_level,
   'coins_earned',coins_earned,'duel_wins',duel_wins,
   'tie_break_at',tie_break_at,'is_verified',is_verified
 ) order by rank)
 from (select * from ranked order by rank limit greatest(1,least(coalesce(p_limit,100),100))) x
),'[]'::jsonb));
$$;

create or replace function public.baladi_finalize_monthly_leaderboard(
 p_month_key text,p_start_at timestamptz,p_end_at timestamptz
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
 v_inserted integer := 0;
 v_paid integer := 0;
begin
 if p_month_key !~ '^[0-9]{4}-[0-9]{2}$' or p_start_at>=p_end_at then
   raise exception 'بازه ماهانه معتبر نیست.';
 end if;
 perform pg_advisory_xact_lock(hashtext('baladi-monthly:'||p_month_key));
 if exists(select 1 from public.baladi_monthly_leaderboard where month_key=p_month_key) then
   return jsonb_build_object('ok',true,'already_finalized',true,
     'winners',(select coalesce(jsonb_agg(jsonb_build_object(
       'rank',rank,'user_id',user_id,'display_name',display_name,'reward_coins',reward_coins
     ) order by rank),'[]'::jsonb)
     from public.baladi_monthly_leaderboard where month_key=p_month_key and rank<=3));
 end if;

 with event_stats as (
   select e.user_id,
     count(*) filter(where e.event_type in ('word_found','bonus_word_found'))::integer valid_words,
     coalesce(max(e.level_number) filter(where e.event_type='level_completed'),0)::integer highest_level,
     coalesce(sum(greatest(e.coin_delta,0)) filter(where e.event_type<>'monthly_leaderboard_reward'),0)::bigint coins_earned,
     max(e.created_at) last_event_at
   from public.baladi_game_events e
   where e.created_at>=p_start_at and e.created_at<p_end_at
   group by e.user_id
 ), duel_stats as (
   select m.winner_id user_id,count(*)::integer duel_wins,max(m.finished_at) last_win_at
   from public.baladi_duel_matches m
   where m.status='completed' and m.winner_id is not null
     and m.finished_at>=p_start_at and m.finished_at<p_end_at
   group by m.winner_id
 ), combined as (
   select p.user_id,coalesce(nullif(btrim(p.display_name),''),'بازیکن') display_name,
     coalesce(e.valid_words,0) valid_words,coalesce(e.highest_level,0) highest_level,
     coalesce(e.coins_earned,0) coins_earned,coalesce(d.duel_wins,0) duel_wins,
     greatest(e.last_event_at,d.last_win_at) tie_break_at
   from public.baladi_game_profiles p
   left join event_stats e on e.user_id=p.user_id
   left join duel_stats d on d.user_id=p.user_id
   where coalesce(e.valid_words,0)>0 or coalesce(e.highest_level,0)>0
     or coalesce(e.coins_earned,0)>0 or coalesce(d.duel_wins,0)>0
 ), ranked as (
   select row_number() over(order by valid_words desc,highest_level desc,coins_earned desc,
     duel_wins desc,tie_break_at asc nulls last,user_id asc)::integer rank,*
   from combined
 )
 insert into public.baladi_monthly_leaderboard(
   month_key,user_id,display_name,valid_words,highest_level,coins_earned,duel_wins,
   tie_break_at,rank,reward_coins,rewarded_at
 )
 select p_month_key,user_id,display_name,valid_words,highest_level,coins_earned,duel_wins,
   tie_break_at,rank,
   case rank when 1 then 7500 when 2 then 4800 when 3 then 3000 else 0 end,
   case when rank<=3 then now() else null end
 from ranked order by rank;
 get diagnostics v_inserted=row_count;

 with winners as (
   select user_id,reward_coins from public.baladi_monthly_leaderboard
   where month_key=p_month_key and rank between 1 and 3 and reward_coins>0
 ), paid as (
   update public.baladi_game_profiles p
   set coins=p.coins+w.reward_coins,updated_at=now()
   from winners w where p.user_id=w.user_id
   returning p.user_id,w.reward_coins
 ), reward_events as (
   insert into public.baladi_game_events(user_id,event_type,event_key,coin_delta,metadata)
   select user_id,'monthly_leaderboard_reward','monthly:'||p_month_key,reward_coins,
     jsonb_build_object('month_key',p_month_key,'reward_coins',reward_coins)
   from paid on conflict do nothing returning id
 )
 select count(*) into v_paid from paid;

 return jsonb_build_object('ok',true,'already_finalized',false,
   'rows_saved',v_inserted,'winners_paid',v_paid,
   'winners',(select coalesce(jsonb_agg(jsonb_build_object(
     'rank',rank,'user_id',user_id,'display_name',display_name,'reward_coins',reward_coins
   ) order by rank),'[]'::jsonb)
   from public.baladi_monthly_leaderboard where month_key=p_month_key and rank<=3));
end;
$$;

revoke all on function public.baladi_monthly_stats(timestamptz,timestamptz,integer) from public,anon,authenticated;
revoke all on function public.baladi_finalize_monthly_leaderboard(text,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.baladi_monthly_stats(timestamptz,timestamptz,integer) to service_role;
grant execute on function public.baladi_finalize_monthly_leaderboard(text,timestamptz,timestamptz) to service_role;
