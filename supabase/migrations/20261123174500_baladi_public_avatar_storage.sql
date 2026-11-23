insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('baladi-avatars', 'baladi-avatars', true, 3145728, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='Baladi avatar upload own folder') then
    create policy "Baladi avatar upload own folder"
    on storage.objects for insert to authenticated
    with check (
      bucket_id = 'baladi-avatars'
      and (storage.foldername(name))[1] = (select auth.uid())::text
      and storage.extension(name) in ('jpg','jpeg','png','webp')
    );
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='Baladi avatar delete own folder') then
    create policy "Baladi avatar delete own folder"
    on storage.objects for delete to authenticated
    using (
      bucket_id = 'baladi-avatars'
      and (storage.foldername(name))[1] = (select auth.uid())::text
    );
  end if;
end $$;