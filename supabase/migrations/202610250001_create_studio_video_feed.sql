-- Alishams Videos feed schema (applied to Supabase project srfldjfrzmtnlabusssq)
create table if not exists public.studio_videos (
 id uuid primary key default gen_random_uuid(),
 slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and char_length(slug) between 3 and 100),
 title text not null check (char_length(title) between 3 and 160),
 description text not null default '' check (char_length(description) <= 3000),
 category text not null default 'other' check (category in ('motion-graphics','reels','advertisement','other')),
 video_url text not null check (char_length(video_url) <= 2000),
 poster_url text not null default '' check (char_length(poster_url) <= 2000),
 aspect_ratio text not null default '9:16' check (aspect_ratio in ('9:16','16:9','1:1')),
 is_published boolean not null default false,
 featured boolean not null default false,
 published_at timestamptz,
 created_at timestamptz not null default now()
);
create table if not exists public.studio_video_comments (
 id uuid primary key default gen_random_uuid(),
 video_id uuid not null references public.studio_videos(id) on delete cascade,
 display_name text not null check (char_length(trim(display_name)) between 2 and 50),
 body text not null check (char_length(trim(body)) between 2 and 700),
 is_approved boolean not null default false,
 created_at timestamptz not null default now()
);
create table if not exists public.studio_video_likes (
 id uuid primary key default gen_random_uuid(),
 video_id uuid not null references public.studio_videos(id) on delete cascade,
 visitor_token text not null check (char_length(visitor_token) between 20 and 100),
 created_at timestamptz not null default now(),
 unique(video_id, visitor_token)
);
create table if not exists public.studio_video_views (
 id uuid primary key default gen_random_uuid(),
 video_id uuid not null references public.studio_videos(id) on delete cascade,
 visitor_token text not null check (char_length(visitor_token) between 20 and 100),
 viewed_on date not null default (now() at time zone 'utc')::date,
 created_at timestamptz not null default now(),
 unique(video_id, visitor_token, viewed_on)
);
create index if not exists studio_videos_published_idx on public.studio_videos (is_published, published_at desc);
create index if not exists studio_video_comments_public_idx on public.studio_video_comments (video_id, created_at desc) where is_approved = true;
create index if not exists studio_video_likes_video_idx on public.studio_video_likes (video_id);
create index if not exists studio_video_views_video_idx on public.studio_video_views (video_id);
alter table public.studio_videos enable row level security;
alter table public.studio_video_comments enable row level security;
alter table public.studio_video_likes enable row level security;
alter table public.studio_video_views enable row level security;
create policy "Published videos are publicly readable" on public.studio_videos for select to anon, authenticated using (is_published = true);
create policy "Approved comments are publicly readable" on public.studio_video_comments for select to anon, authenticated using (is_approved = true);
create policy "Visitors can submit comments for published videos" on public.studio_video_comments for insert to anon, authenticated with check (is_approved = false and char_length(trim(display_name)) between 2 and 50 and char_length(trim(body)) between 2 and 700 and exists (select 1 from public.studio_videos v where v.id = video_id and v.is_published = true));
create policy "Like counts are publicly readable" on public.studio_video_likes for select to anon, authenticated using (exists (select 1 from public.studio_videos v where v.id = video_id and v.is_published = true));
create policy "Visitors can like published videos" on public.studio_video_likes for insert to anon, authenticated with check (char_length(visitor_token) between 20 and 100 and exists (select 1 from public.studio_videos v where v.id = video_id and v.is_published = true));
create policy "Visitors can remove their local-token like" on public.studio_video_likes for delete to anon, authenticated using (char_length(visitor_token) between 20 and 100);
create policy "View counts are publicly readable" on public.studio_video_views for select to anon, authenticated using (exists (select 1 from public.studio_videos v where v.id = video_id and v.is_published = true));
create policy "Visitors can register views for published videos" on public.studio_video_views for insert to anon, authenticated with check (char_length(visitor_token) between 20 and 100 and exists (select 1 from public.studio_videos v where v.id = video_id and v.is_published = true));
grant select on public.studio_videos to anon, authenticated;
grant select, insert on public.studio_video_comments to anon, authenticated;
grant select, insert, delete on public.studio_video_likes to anon, authenticated;
grant select, insert on public.studio_video_views to anon, authenticated;
