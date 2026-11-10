create table if not exists public.mobile_app_portfolio_visibility (
  item_key text primary key check (char_length(item_key) between 3 and 180),
  source text not null check (source in ('website','portfolio','video')),
  title text not null default '',
  is_visible boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.mobile_app_portfolio_visibility enable row level security;
create policy "Public can read mobile app portfolio visibility settings"
on public.mobile_app_portfolio_visibility for select to anon, authenticated using (true);
create policy "App admin can read all mobile app portfolio visibility"
on public.mobile_app_portfolio_visibility for select to authenticated
using ((select auth.jwt()->>'email')='theslyapex@gmail.com' and (select auth.jwt()->>'aal')='aal2');
create policy "App admin can insert mobile app portfolio visibility"
on public.mobile_app_portfolio_visibility for insert to authenticated
with check ((select auth.jwt()->>'email')='theslyapex@gmail.com' and (select auth.jwt()->>'aal')='aal2');
create policy "App admin can update mobile app portfolio visibility"
on public.mobile_app_portfolio_visibility for update to authenticated
using ((select auth.jwt()->>'email')='theslyapex@gmail.com' and (select auth.jwt()->>'aal')='aal2')
with check ((select auth.jwt()->>'email')='theslyapex@gmail.com' and (select auth.jwt()->>'aal')='aal2');
grant select on public.mobile_app_portfolio_visibility to anon, authenticated;
grant insert, update on public.mobile_app_portfolio_visibility to authenticated;
create index if not exists mobile_app_portfolio_visibility_visible_idx
on public.mobile_app_portfolio_visibility (is_visible) where is_visible=true;
