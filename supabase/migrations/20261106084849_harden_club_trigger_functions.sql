-- Trigger handlers are invoked by their table triggers, not exposed as public RPC endpoints.
alter function public.club_tier(integer) set search_path = public, pg_temp;
revoke all on function public.club_award_plus_purchase() from public, anon, authenticated;
revoke all on function public.club_award_bale_plus_purchase() from public, anon, authenticated;
revoke all on function public.club_award_confirmed_project_payment() from public, anon, authenticated;
revoke all on function public.club_award_qualified_referral() from public, anon, authenticated;
