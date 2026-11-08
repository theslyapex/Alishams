-- Update club league thresholds to the revised five-level system.
-- Ranking is based on lifetime earned points, not the redeemable balance.
create or replace function public.club_tier(p_lifetime integer)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when coalesce(p_lifetime, 0) >= 25000 then 'diamond'
    when coalesce(p_lifetime, 0) >= 18000 then 'gold'
    when coalesce(p_lifetime, 0) >= 10000 then 'silver'
    when coalesce(p_lifetime, 0) >= 2500 then 'bronze'
    else 'none'
  end;
$$;

alter function public.club_tier(integer) set search_path = public, pg_temp;
