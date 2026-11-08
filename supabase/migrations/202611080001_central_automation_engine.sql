create schema if not exists private;
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create table if not exists public.automation_rules (
  rule_key text primary key,
  title text not null,
  description text not null default '',
  enabled boolean not null default true,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.automation_queue (
  id uuid primary key default gen_random_uuid(),
  rule_key text not null references public.automation_rules(rule_key) on update cascade,
  event_key text not null unique,
  target_type text not null,
  target_id text not null,
  user_id uuid references auth.users(id) on delete set null,
  recipient_email text not null default '',
  project_id uuid references public.client_projects(id) on delete set null,
  title text not null,
  message text not null default '',
  channels text[] not null default '{}'::text[],
  delivered_channels text[] not null default '{}'::text[],
  payload jsonb not null default '{}'::jsonb,
  due_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending','processing','sent','failed','skipped')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 10),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  sent_at timestamptz,
  last_error text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists automation_queue_due_idx
  on public.automation_queue(status,next_attempt_at,due_at)
  where status in ('pending','failed','processing');
create index if not exists automation_queue_rule_created_idx
  on public.automation_queue(rule_key,created_at desc);

create table if not exists public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  trigger_source text not null default 'cron',
  status text not null default 'running' check (status in ('running','completed','partial','failed')),
  scanned_count integer not null default 0,
  enqueued_count integer not null default 0,
  processed_count integer not null default 0,
  sent_count integer not null default 0,
  failed_count integer not null default 0,
  skipped_count integer not null default 0,
  error_summary text not null default '',
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists automation_runs_started_idx on public.automation_runs(started_at desc);

create table if not exists public.customer_domains (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  customer_name text not null default '',
  customer_email text not null,
  domain_name text not null,
  registrar text not null default '',
  expires_at date not null,
  auto_renew boolean not null default false,
  status text not null default 'active' check (status in ('active','expired','transferred','cancelled')),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(domain_name)
);
create index if not exists customer_domains_expiry_idx
  on public.customer_domains(status,expires_at);

insert into public.automation_rules(rule_key,title,description,enabled,settings) values
('order_review_4h','پیگیری سفارش بررسی‌نشده','هشدار به مدیر برای سفارش جدیدی که بیش از ۴ ساعت بررسی نشده است.',true,'{"delay_hours":4}'::jsonb),
('order_review_24h','یادآوری سفارش بررسی‌نشده','یادآوری دوم به مدیر برای سفارش بررسی‌نشده پس از ۲۴ ساعت.',true,'{"delay_hours":24}'::jsonb),
('customer_offer_24h','یادآوری پیشنهاد منتظر مشتری','یادآوری محترمانه به مشتری برای پیشنهاد یا سفارش منتظر پاسخ پس از ۲۴ ساعت.',true,'{"delay_hours":24}'::jsonb),
('project_due_3d','موعد پروژه؛ سه روز مانده','هشدار به مدیر و مشتری سه روز پیش از موعد پروژه.',true,'{"days":3}'::jsonb),
('project_due_1d','موعد پروژه؛ یک روز مانده','هشدار به مدیر و مشتری یک روز پیش از موعد پروژه.',true,'{"days":1}'::jsonb),
('project_overdue_daily','پروژه دارای تأخیر','گزارش روزانه پروژه‌هایی که از موعد تحویل عبور کرده‌اند.',true,'{}'::jsonb),
('project_balance_7d','مانده پرداخت پروژه','هشدار داخلی درباره مانده پرداخت پروژه‌ای که دست‌کم هفت روز بدون پرداخت مانده است؛ بدون پیام خودکار به مشتری.',true,'{"delay_days":7}'::jsonb),
('plus_receipt_review_6h','رسید پلاس+ در انتظار بررسی','هشدار به مدیر برای رسید کارت‌به‌کارت پلاس+ که بیش از شش ساعت بررسی نشده است.',true,'{"delay_hours":6}'::jsonb),
('plus_expiry_1d','یادآوری یک روز مانده پلاس+','یادآوری یک روز پیش از پایان عضویت پلاس+.',true,'{}'::jsonb),
('plus_expired','پایان اعتبار پلاس+','اطلاع‌رسانی به عضو پس از پایان اعتبار پلاس+.',true,'{}'::jsonb),
('project_review_2d','درخواست ثبت دیدگاه پس از تحویل','درخواست ثبت دیدگاه دو روز پس از تکمیل پروژه، در صورت ثبت‌نشدن نظر.',true,'{"delay_days":2}'::jsonb),
('domain_expiry_30d','تمدید دامنه؛ ۳۰ روز مانده','یادآوری تمدید دامنه ۳۰ روز پیش از انقضا.',true,'{"days":30}'::jsonb),
('domain_expiry_14d','تمدید دامنه؛ ۱۴ روز مانده','یادآوری تمدید دامنه ۱۴ روز پیش از انقضا.',true,'{"days":14}'::jsonb),
('domain_expiry_7d','تمدید دامنه؛ ۷ روز مانده','یادآوری تمدید دامنه ۷ روز پیش از انقضا.',true,'{"days":7}'::jsonb),
('domain_expiry_1d','تمدید دامنه؛ یک روز مانده','یادآوری تمدید دامنه یک روز پیش از انقضا.',true,'{"days":1}'::jsonb)
on conflict(rule_key) do update set
  title=excluded.title, description=excluded.description, settings=excluded.settings,
  updated_at=now();

alter table public.automation_rules enable row level security;
alter table public.automation_queue enable row level security;
alter table public.automation_runs enable row level security;
alter table public.customer_domains enable row level security;

revoke all on public.automation_rules,public.automation_queue,public.automation_runs,public.customer_domains from anon,authenticated;
grant all on public.automation_rules,public.automation_queue,public.automation_runs,public.customer_domains to service_role;


create or replace function public.automation_user_id_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $
  select u.id
    from auth.users u
   where lower(trim(u.email)) = lower(trim(p_email))
     and u.email_confirmed_at is not null
   order by u.created_at
   limit 1;
$;
revoke all on function public.automation_user_id_by_email(text) from public,anon,authenticated;
grant execute on function public.automation_user_id_by_email(text) to service_role;

create or replace function public.verify_automation_cron_token(p_token text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select decrypted_secret = p_token
       from vault.decrypted_secrets
      where name = 'automation_cron_token'
      limit 1),
    false
  );
$$;
revoke all on function public.verify_automation_cron_token(text) from public,anon,authenticated;
grant execute on function public.verify_automation_cron_token(text) to service_role;

create or replace function public.claim_automation_queue(p_limit integer default 30)
returns setof public.automation_queue
language sql
security definer
set search_path = public,pg_temp
as $$
  with picked as (
    select id
    from public.automation_queue
    where status in ('pending','failed')
      and next_attempt_at <= now()
      and due_at <= now()
      and attempts < max_attempts
    order by due_at,created_at
    for update skip locked
    limit greatest(1,least(coalesce(p_limit,30),100))
  )
  update public.automation_queue q
     set status='processing', attempts=q.attempts+1,
         locked_at=now(), updated_at=now()
    from picked
   where q.id=picked.id
  returning q.*;
$$;
revoke all on function public.claim_automation_queue(integer) from public,anon,authenticated;
grant execute on function public.claim_automation_queue(integer) to service_role;

create or replace function public.touch_automation_updated_at()
returns trigger
language plpgsql
set search_path = public,pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists automation_rules_touch_updated_at on public.automation_rules;
create trigger automation_rules_touch_updated_at before update on public.automation_rules
for each row execute function public.touch_automation_updated_at();
drop trigger if exists customer_domains_touch_updated_at on public.customer_domains;
create trigger customer_domains_touch_updated_at before update on public.customer_domains
for each row execute function public.touch_automation_updated_at();
revoke all on function public.touch_automation_updated_at() from public,anon,authenticated;

do $$
begin
  if not exists (select 1 from vault.secrets where name='automation_cron_token') then
    perform vault.create_secret(
      gen_random_uuid()::text || gen_random_uuid()::text,
      'automation_cron_token',
      'Private token used only by the Alishams automation scheduler'
    );
  end if;
end;
$$;

select cron.unschedule(jobid)
from cron.job
where jobname='alishams-automation-engine';

select cron.schedule(
  'alishams-automation-engine',
  '*/15 * * * *',
  $job$
  select net.http_post(
    url := 'https://srfldjfrzmtnlabusssq.supabase.co/functions/v1/automation-engine',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'apikey','sb_publishable_UW2Wzzp8Y-KKd82nZHQUKA_RGl876RB',
      'x-automation-token',(select decrypted_secret from vault.decrypted_secrets where name='automation_cron_token' limit 1)
    ),
    body := jsonb_build_object('trigger_source','cron'),
    timeout_milliseconds := 15000
  );
  $job$
);
