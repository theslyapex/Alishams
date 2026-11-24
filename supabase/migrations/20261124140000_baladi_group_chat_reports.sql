create table if not exists public.baladi_group_chat_reports (
 id uuid primary key default gen_random_uuid(),
 group_id uuid not null references public.baladi_groups(id) on delete cascade,
 message_id bigint not null references public.baladi_group_messages(id) on delete cascade,
 reporter_id uuid not null references auth.users(id) on delete cascade,
 reason text not null check (reason in ('تبلیغات و هرزنامه','توهین و آزار','محتوای نامناسب','تهدید یا کلاهبرداری','سایر موارد')),
 status text not null default 'open' check (status in ('open','reviewing','resolved','dismissed')),
 created_at timestamptz not null default now(),
 unique(message_id,reporter_id)
);
create index if not exists baladi_group_chat_reports_group_idx on public.baladi_group_chat_reports(group_id,created_at desc);
alter table public.baladi_group_chat_reports enable row level security;
revoke all on public.baladi_group_chat_reports from anon,authenticated;
grant select,insert on public.baladi_group_chat_reports to service_role;

create or replace function public.baladi_report_group_chat_message(
 p_user_id uuid,p_group_id uuid,p_message_id bigint,p_reason text
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
 v_message public.baladi_group_messages%rowtype;
 v_inserted integer := 0;
begin
 if p_reason not in ('تبلیغات و هرزنامه','توهین و آزار','محتوای نامناسب','تهدید یا کلاهبرداری','سایر موارد') then
  raise exception 'دلیل گزارش معتبر نیست.';
 end if;
 if not exists(select 1 from public.baladi_group_members where group_id=p_group_id and user_id=p_user_id) then
  raise exception 'فقط اعضای گروه می‌توانند پیام‌های آن را گزارش کنند.';
 end if;
 select * into v_message from public.baladi_group_messages where id=p_message_id and group_id=p_group_id;
 if not found then raise exception 'پیام موردنظر پیدا نشد.'; end if;
 if v_message.user_id=p_user_id then raise exception 'نمی‌توانی پیام خودت را گزارش کنی.'; end if;
 insert into public.baladi_group_chat_reports(group_id,message_id,reporter_id,reason)
 values(p_group_id,p_message_id,p_user_id,p_reason)
 on conflict(message_id,reporter_id) do nothing;
 get diagnostics v_inserted = row_count;
 return jsonb_build_object('ok',true,'already_reported',v_inserted=0);
end $$;
revoke all on function public.baladi_report_group_chat_message(uuid,uuid,bigint,text) from public,anon,authenticated;
grant execute on function public.baladi_report_group_chat_message(uuid,uuid,bigint,text) to service_role;
