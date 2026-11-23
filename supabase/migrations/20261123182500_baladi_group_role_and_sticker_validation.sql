create or replace function public.baladi_pin_group_message(p_user_id uuid,p_group_id uuid,p_message_id bigint,p_pinned boolean)
returns jsonb
language plpgsql
set search_path=public,pg_temp
as $$
declare
  v_role text;
begin
  select role into v_role from public.baladi_group_members where group_id=p_group_id and user_id=p_user_id;
  if v_role is null or v_role not in ('veteran','deputy','leader') then
    raise exception 'فقط پیشکسوت، قائم‌مقام یا رهبر می‌تواند پیام را سنجاق کند.';
  end if;
  update public.baladi_group_messages
  set is_pinned=p_pinned,pinned_by=case when p_pinned then p_user_id else null end,pinned_at=case when p_pinned then now() else null end
  where id=p_message_id and group_id=p_group_id;
  if not found then raise exception 'پیام گروه پیدا نشد.'; end if;
  return jsonb_build_object('ok',true);
end;
$$;

create or replace function public.baladi_send_group_message(p_user_id uuid,p_group_id uuid,p_body text default null,p_sticker_id text default null)
returns jsonb
language plpgsql
set search_path=public,pg_temp
as $$
declare
  v_body text := nullif(btrim(coalesce(p_body,'')),'');
  v_message public.baladi_group_messages%rowtype;
begin
  if not exists(select 1 from public.baladi_group_members where group_id=p_group_id and user_id=p_user_id) then
    raise exception 'برای ارسال پیام باید عضو گروه باشی.';
  end if;
  if p_sticker_id is null then
    if v_body is null or char_length(v_body)>350 then raise exception 'پیام باید بین ۱ تا ۳۵۰ نویسه باشد.'; end if;
  else
    if v_body is not null then raise exception 'ارسال متن و استیکر هم‌زمان مجاز نیست.'; end if;
    if not exists(select 1 from public.baladi_cosmetic_catalog where id=p_sticker_id and kind='sticker' and is_active=true) then
      raise exception 'استیکر معتبر نیست.';
    end if;
    if not exists(select 1 from public.baladi_user_cosmetics where user_id=p_user_id and cosmetic_id=p_sticker_id) then
      raise exception 'ابتدا باید این استیکر را بخری.';
    end if;
  end if;
  insert into public.baladi_group_messages(group_id,user_id,body,sticker_id)
  values(p_group_id,p_user_id,v_body,p_sticker_id)
  returning * into v_message;
  return jsonb_build_object('id',v_message.id,'group_id',v_message.group_id,'user_id',v_message.user_id,'body',v_message.body,'sticker_id',v_message.sticker_id,'created_at',v_message.created_at);
end;
$$;

create index if not exists baladi_groups_leader_idx on public.baladi_groups(leader_id);
create index if not exists baladi_group_messages_sticker_idx on public.baladi_group_messages(sticker_id);