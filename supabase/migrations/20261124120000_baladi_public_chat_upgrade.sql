create table if not exists public.baladi_global_chat_reports (
 id uuid primary key default gen_random_uuid(),
 message_id bigint not null references public.baladi_global_chat_messages(id) on delete cascade,
 reporter_id uuid not null references auth.users(id) on delete cascade,
 reason text not null check (char_length(reason) between 3 and 120),
 status text not null default 'open' check (status in ('open','reviewing','resolved','dismissed')),
 created_at timestamptz not null default now(),
 unique(message_id,reporter_id)
);
alter table public.baladi_global_chat_reports enable row level security;
revoke all on public.baladi_global_chat_reports from anon,authenticated;
grant select,insert on public.baladi_global_chat_reports to service_role;

create or replace function public.baladi_unlock_global_chat(p_user_id uuid)
returns jsonb language plpgsql set search_path=public,pg_temp as $$
declare v_profile public.baladi_game_profiles%rowtype;
begin
 select * into v_profile from public.baladi_game_profiles where user_id=p_user_id for update;
 if not found then raise exception 'پروفایل بازی پیدا نشد.'; end if;
 if v_profile.chat_unlocked_at is not null then
   return jsonb_build_object('profile',to_jsonb(v_profile),'already_unlocked',true,'cost',0);
 end if;
 if v_profile.coins < 5000 then raise exception 'برای بازکردن دائمی چت، ۵۰۰۰ سکه لازم داری.'; end if;
 update public.baladi_game_profiles set coins=coins-5000,chat_unlocked_at=now(),updated_at=now()
 where user_id=p_user_id returning * into v_profile;
 return jsonb_build_object('profile',to_jsonb(v_profile),'already_unlocked',false,'cost',5000);
end $$;
revoke all on function public.baladi_unlock_global_chat(uuid) from public,anon,authenticated;
grant execute on function public.baladi_unlock_global_chat(uuid) to service_role;

create or replace function public.baladi_report_global_chat_message(p_user_id uuid,p_message_id bigint,p_reason text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
 v_message public.baladi_global_chat_messages%rowtype;
 v_inserted integer := 0;
begin
 if p_reason not in ('تبلیغات و هرزنامه','توهین و آزار','محتوای نامناسب','تهدید یا کلاهبرداری','سایر موارد') then
   raise exception 'دلیل گزارش معتبر نیست.';
 end if;
 select * into v_message from public.baladi_global_chat_messages
 where id=p_message_id and deleted_at is null;
 if not found then raise exception 'این پیام دیگر در دسترس نیست.'; end if;
 if v_message.user_id=p_user_id then raise exception 'نمی‌توانی پیام خودت را گزارش کنی.'; end if;
 insert into public.baladi_global_chat_reports(message_id,reporter_id,reason)
 values(p_message_id,p_user_id,p_reason)
 on conflict(message_id,reporter_id) do nothing;
 get diagnostics v_inserted = row_count;
 return jsonb_build_object('ok',true,'already_reported',v_inserted=0);
end $$;
revoke all on function public.baladi_report_global_chat_message(uuid,bigint,text) from public,anon,authenticated;
grant execute on function public.baladi_report_global_chat_message(uuid,bigint,text) to service_role;
