-- Baladi advanced notification engine.
create table if not exists public.baladi_device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  fcm_token text not null unique,
  platform text not null default 'android' check (platform in ('android','ios','web')),
  device_label text not null default '',
  enabled boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists baladi_device_tokens_user_enabled_idx on public.baladi_device_tokens(user_id, enabled);
create table if not exists public.baladi_notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  game_results boolean not null default true,
  duel_invites boolean not null default true,
  group_leadership boolean not null default true,
  admin_messages boolean not null default true,
  rewards boolean not null default true,
  sound_enabled boolean not null default true,
  vibration_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
create table if not exists public.baladi_push_outbox (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null unique references public.account_notifications(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','processing','sent','partial','failed','skipped')),
  attempts integer not null default 0,
  last_error text not null default '',
  provider_message_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
create index if not exists baladi_push_outbox_pending_idx on public.baladi_push_outbox(status, created_at) where status in ('pending','failed');
alter table public.baladi_device_tokens enable row level security;
alter table public.baladi_notification_preferences enable row level security;
alter table public.baladi_push_outbox enable row level security;
revoke all on public.baladi_device_tokens from anon, authenticated;
revoke all on public.baladi_notification_preferences from anon, authenticated;
revoke all on public.baladi_push_outbox from anon, authenticated;
create or replace function public.baladi_enqueue_push_for_notification()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$ begin
  insert into public.baladi_push_outbox(notification_id,user_id) values(new.id,new.user_id) on conflict(notification_id) do nothing;
  return new;
end; $$;
revoke all on function public.baladi_enqueue_push_for_notification() from public,anon,authenticated;
drop trigger if exists baladi_notification_enqueue_push on public.account_notifications;
create trigger baladi_notification_enqueue_push after insert on public.account_notifications for each row execute function public.baladi_enqueue_push_for_notification();
create or replace function public.baladi_notify_group_leadership_message()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_role text; v_group_name text; v_preview text; v_member record;
begin
  select gm.role,g.name into v_role,v_group_name from public.baladi_group_members gm join public.baladi_groups g on g.id=gm.group_id where gm.group_id=new.group_id and gm.user_id=new.user_id;
  if coalesce(v_role,'member') not in ('leader','deputy') then return new; end if;
  v_preview := left(regexp_replace(coalesce(new.body,''), '\s+', ' ', 'g'),140);
  if v_preview='' and new.sticker_id is not null then v_preview := 'یک استیکر ارسال کرد'; end if;
  if v_preview='' then v_preview := 'پیام جدیدی در گروه ثبت شد'; end if;
  for v_member in select user_id from public.baladi_group_members where group_id=new.group_id and user_id<>new.user_id loop
    insert into public.account_notifications(user_id,source,source_id,event_key,title,body)
    values(v_member.user_id,'baladi_group',new.group_id::text,'leadership_message:'||new.id::text,
      case when v_role='leader' then 'پیام رهبر گروه' else 'پیام قائم‌مقام گروه' end || ' · ' || coalesce(v_group_name,'گروه'),v_preview)
    on conflict(user_id,source,source_id,event_key) do nothing;
  end loop;
  return new;
end; $$;
revoke all on function public.baladi_notify_group_leadership_message() from public,anon,authenticated;
drop trigger if exists baladi_group_leadership_message_notify on public.baladi_group_messages;
create trigger baladi_group_leadership_message_notify after insert on public.baladi_group_messages for each row execute function public.baladi_notify_group_leadership_message();
create or replace function public.baladi_notify_duel_invite()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_sender text;
begin
  if new.status<>'pending' then return new; end if;
  select display_name into v_sender from public.baladi_game_profiles where user_id=new.sender_id;
  insert into public.account_notifications(user_id,source,source_id,event_key,title,body)
  values(new.recipient_id,'baladi_duel',new.id::text,'invite_received','درخواست مسابقه دونفره',coalesce(v_sender,'یک بازیکن')||' برای مسابقه دونفره به تو درخواست داده است.')
  on conflict(user_id,source,source_id,event_key) do nothing;
  return new;
end; $$;
revoke all on function public.baladi_notify_duel_invite() from public,anon,authenticated;
drop trigger if exists baladi_duel_invite_notify on public.baladi_duel_invites;
create trigger baladi_duel_invite_notify after insert on public.baladi_duel_invites for each row execute function public.baladi_notify_duel_invite();
create or replace function public.baladi_notify_duel_result()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_loser_id uuid;
begin
  if old.status is distinct from new.status and new.status='completed' and new.winner_id is not null then
    v_loser_id := case when new.player_one=new.winner_id then new.player_two else new.player_one end;
    insert into public.account_notifications(user_id,source,source_id,event_key,title,body)
    values(new.winner_id,'baladi_duel',new.id::text,'match_won','پیروزی در مسابقه!','تبریک! تو در مسابقه دونفره پیروز شدی.'),
      (v_loser_id,'baladi_duel',new.id::text,'match_lost','پایان مسابقه','این مسابقه را واگذار کردی. دوباره تلاش کن و انتقامت را بگیر!')
    on conflict(user_id,source,source_id,event_key) do nothing;
  end if;
  return new;
end; $$;
revoke all on function public.baladi_notify_duel_result() from public,anon,authenticated;
drop trigger if exists baladi_duel_result_notify on public.baladi_duel_matches;
create trigger baladi_duel_result_notify after update of status on public.baladi_duel_matches for each row execute function public.baladi_notify_duel_result();
create or replace function public.baladi_notification_default_preferences()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$ begin
  insert into public.baladi_notification_preferences(user_id) values(new.user_id) on conflict(user_id) do nothing;
  return new;
end; $$;
revoke all on function public.baladi_notification_default_preferences() from public,anon,authenticated;
drop trigger if exists baladi_notification_preferences_default on public.account_notifications;
create trigger baladi_notification_preferences_default after insert on public.account_notifications for each row execute function public.baladi_notification_default_preferences();
