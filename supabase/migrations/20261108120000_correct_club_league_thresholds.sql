-- Align the database-backed club tier calculation with the five public league levels.
-- Lifetime points are cumulative earned points; redeemed points do not reduce this total.
create or replace function public.club_tier(p_lifetime integer)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when coalesce(p_lifetime, 0) >= 9500 then 'diamond'
    when coalesce(p_lifetime, 0) >= 7500 then 'gold'
    when coalesce(p_lifetime, 0) >= 5000 then 'silver'
    when coalesce(p_lifetime, 0) >= 2500 then 'bronze'
    else 'none'
  end;
$$;

alter function public.club_tier(integer) set search_path = public, pg_temp;
