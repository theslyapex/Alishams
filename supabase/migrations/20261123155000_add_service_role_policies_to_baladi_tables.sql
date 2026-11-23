drop policy if exists baladi_service_role_access on public.baladi_game_profiles;
drop policy if exists baladi_service_role_access on public.baladi_game_sessions;
drop policy if exists baladi_service_role_access on public.baladi_game_events;
drop policy if exists baladi_service_role_access on public.baladi_game_level_catalog;
create policy baladi_service_role_access on public.baladi_game_profiles for all to service_role using (true) with check (true);
create policy baladi_service_role_access on public.baladi_game_sessions for all to service_role using (true) with check (true);
create policy baladi_service_role_access on public.baladi_game_events for all to service_role using (true) with check (true);
create policy baladi_service_role_access on public.baladi_game_level_catalog for all to service_role using (true) with check (true);
