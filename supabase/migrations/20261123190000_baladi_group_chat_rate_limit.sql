create or replace function public.baladi_send_group_message(p_user_id uuid,p_group_id uuid,p_body text default null,p_sticker_id text default null)
returns jsonb
language plpgsql
set search_path=public,pg_temp
as $$
declare
  v_body text := nullif(btrim(coalesce(p_body,'')),'');
  v_message public.baladi_group_messages%rowtype;
  v_last timestamptz;
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
  select created_at into v_last
  from public.baladi_group_messages
  where group_id=p_group_id and user_id=p_user_id
  order by created_at desc limit 1;
  if v_last is not null and v_last>now()-interval '2 seconds' then
    raise exception 'برای ارسال پیام بعدی کمی صبر کن.';
  end if;
  insert into public.baladi_group_messages(group_id,user_id,body,sticker_id)
  values(p_group_id,p_user_id,v_body,p_sticker_id)
  returning * into v_message;
  return jsonb_build_object('id',v_message.id,'group_id',v_message.group_id,'user_id',v_message.user_id,'body',v_message.body,'sticker_id',v_message.sticker_id,'created_at',v_message.created_at);
end;
$$;