-- Admin-only write access for the Alishams video feed.
-- Supabase Auth magic-link sign-in is restricted in the admin UI to the owner email.
drop policy if exists "Video admin manages videos" on public.studio_videos;
create policy "Video admin manages videos" on public.studio_videos for all to authenticated
using ((select auth.jwt()->>'email') = 'theslyapex@gmail.com')
with check ((select auth.jwt()->>'email') = 'theslyapex@gmail.com');
drop policy if exists "Video admin moderates comments" on public.studio_video_comments;
create policy "Video admin moderates comments" on public.studio_video_comments for update to authenticated
using ((select auth.jwt()->>'email') = 'theslyapex@gmail.com')
with check ((select auth.jwt()->>'email') = 'theslyapex@gmail.com');
drop policy if exists "Video admin can read all comments" on public.studio_video_comments;
create policy "Video admin can read all comments" on public.studio_video_comments for select to authenticated
using ((select auth.jwt()->>'email') = 'theslyapex@gmail.com');
drop policy if exists "Video admin can delete comments" on public.studio_video_comments;
create policy "Video admin can delete comments" on public.studio_video_comments for delete to authenticated
using ((select auth.jwt()->>'email') = 'theslyapex@gmail.com');
grant insert, update, delete on public.studio_videos to authenticated;
grant update, delete on public.studio_video_comments to authenticated;
-- Public likes are append-only to avoid exposing a public delete vector.
drop policy if exists "Visitors can remove their local-token like" on public.studio_video_likes;
revoke delete on public.studio_video_likes from anon, authenticated;
