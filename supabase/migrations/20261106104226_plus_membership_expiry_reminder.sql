create extension if not exists pg_cron with schema pg_catalog;

create or replace function public.enqueue_plus_expiry_notifications()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  inserted_count integer := 0;
begin
  insert into public.account_notifications
    (user_id, source, source_id, event_key, title, body)
  select
    m.user_id,
    'plus_memberships',
    m.user_id::text,
    'expiry_3_days_' || to_char(m.ends_at at time zone 'UTC', 'YYYYMMDDHH24MI'),
    'یادآوری تمدید پلاس+',
    'اعتبار عضویت پلاس+ شما در تاریخ ' ||
      to_char(m.ends_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') ||
      ' (به وقت UTC) به پایان می‌رسد. برای تمدید، وارد صفحه پلاس+ شوید.'
  from public.plus_memberships m
  where m.status = 'active'
    and m.ends_at > now() + interval '2 days'
    and m.ends_at <= now() + interval '3 days'
  on conflict (user_id, source, source_id, event_key) do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

revoke all on function public.enqueue_plus_expiry_notifications() from public;
revoke all on function public.enqueue_plus_expiry_notifications() from anon;
revoke all on function public.enqueue_plus_expiry_notifications() from authenticated;

select cron.schedule(
  'plus-membership-expiry-reminder',
  '0 9 * * *',
  $$ select public.enqueue_plus_expiry_notifications(); $$
);