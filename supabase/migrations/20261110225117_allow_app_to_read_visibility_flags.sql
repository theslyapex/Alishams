drop policy if exists "Public can read visible mobile app portfolio items" on public.mobile_app_portfolio_visibility;
drop policy if exists "Public can read mobile app portfolio visibility settings" on public.mobile_app_portfolio_visibility;
create policy "Public can read mobile app portfolio visibility settings"
on public.mobile_app_portfolio_visibility for select to anon, authenticated using (true);
