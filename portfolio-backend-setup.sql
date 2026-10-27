-- Alishams Studio portfolio system — run once in Supabase SQL Editor.
-- After running: create/sign in to your admin user in Supabase Auth, then insert that user's UUID into portfolio_admins.
create extension if not exists pgcrypto;
create table if not exists public.portfolio_items (
 id uuid primary key default gen_random_uuid(),
 category text not null check (category in ('logo','ad-image')),
 title text not null,
 description text not null default '',
 image_path text not null,
 cover_path text,
 published boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 view_count bigint not null default 0
);
create table if not exists public.portfolio_page_views (
 id bigint generated always as identity primary key,
 page_key text not null check (page_key in ('logo','ad-image')),
 viewed_at timestamptz not null default now()
);
create table if not exists public.portfolio_item_views (
 id bigint generated always as identity primary key,
 item_id uuid not null references public.portfolio_items(id) on delete cascade,
 viewed_at timestamptz not null default now()
);
create table if not exists public.portfolio_admins (
 user_id uuid primary key references auth.users(id) on delete cascade,
 created_at timestamptz not null default now()
);
alter table public.portfolio_items enable row level security;
alter table public.portfolio_page_views enable row level security;
alter table public.portfolio_item_views enable row level security;
alter table public.portfolio_admins enable row level security;
drop policy if exists "Public can read published portfolio items" on public.portfolio_items;
create policy "Public can read published portfolio items" on public.portfolio_items for select using (published = true or exists(select 1 from public.portfolio_admins a where a.user_id = auth.uid()));
drop policy if exists "Admins manage portfolio items" on public.portfolio_items;
create policy "Admins manage portfolio items" on public.portfolio_items for all to authenticated using (exists(select 1 from public.portfolio_admins a where a.user_id = auth.uid())) with check (exists(select 1 from public.portfolio_admins a where a.user_id = auth.uid()));
drop policy if exists "Admins read page views" on public.portfolio_page_views;
create policy "Admins read page views" on public.portfolio_page_views for select to authenticated using (exists(select 1 from public.portfolio_admins a where a.user_id = auth.uid()));
drop policy if exists "Admins read item views" on public.portfolio_item_views;
create policy "Admins read item views" on public.portfolio_item_views for select to authenticated using (exists(select 1 from public.portfolio_admins a where a.user_id = auth.uid()));
drop policy if exists "Admins read admin list" on public.portfolio_admins;
create policy "Admins read admin list" on public.portfolio_admins for select to authenticated using (user_id = auth.uid());
-- RPCs keep counters and logs in one transaction. They intentionally don't accept arbitrary SQL.
create or replace function public.record_portfolio_page_view(p_page_key text)
returns void language plpgsql security definer set search_path = public as $$
begin
 if p_page_key not in ('logo','ad-image') then raise exception 'Invalid page key'; end if;
 insert into public.portfolio_page_views(page_key) values (p_page_key);
end; $$;
create or replace function public.record_portfolio_item_view(p_item_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
 if not exists(select 1 from public.portfolio_items where id=p_item_id and published=true) then return; end if;
 insert into public.portfolio_item_views(item_id) values (p_item_id);
 update public.portfolio_items set view_count=view_count+1 where id=p_item_id and published=true;
end; $$;
revoke all on function public.record_portfolio_page_view(text) from public;
grant execute on function public.record_portfolio_page_view(text) to anon, authenticated;
revoke all on function public.record_portfolio_item_view(uuid) from public;
grant execute on function public.record_portfolio_item_view(uuid) to anon, authenticated;
revoke all on public.portfolio_page_views from anon, authenticated;
revoke all on public.portfolio_item_views from anon, authenticated;
grant select on public.portfolio_page_views to authenticated;
grant select on public.portfolio_item_views to authenticated;
grant select on public.portfolio_items to anon, authenticated;
grant insert, update, delete on public.portfolio_items to authenticated;
grant select on public.portfolio_admins to authenticated;
-- Create a PUBLIC bucket for display images; writes/deletes are admin-only.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('portfolio-images','portfolio-images',true,12582912,array['image/jpeg','image/png','image/webp','image/avif'])
on conflict (id) do update set public=true,file_size_limit=12582912,allowed_mime_types=array['image/jpeg','image/png','image/webp','image/avif'];
drop policy if exists "Public reads portfolio images" on storage.objects;
create policy "Public reads portfolio images" on storage.objects for select using (bucket_id='portfolio-images');
drop policy if exists "Admins upload portfolio images" on storage.objects;
create policy "Admins upload portfolio images" on storage.objects for insert to authenticated with check (bucket_id='portfolio-images' and exists(select 1 from public.portfolio_admins a where a.user_id=auth.uid()));
drop policy if exists "Admins update portfolio images" on storage.objects;
create policy "Admins update portfolio images" on storage.objects for update to authenticated using (bucket_id='portfolio-images' and exists(select 1 from public.portfolio_admins a where a.user_id=auth.uid())) with check (bucket_id='portfolio-images' and exists(select 1 from public.portfolio_admins a where a.user_id=auth.uid()));
drop policy if exists "Admins delete portfolio images" on storage.objects;
create policy "Admins delete portfolio images" on storage.objects for delete to authenticated using (bucket_id='portfolio-images' and exists(select 1 from public.portfolio_admins a where a.user_id=auth.uid()));
