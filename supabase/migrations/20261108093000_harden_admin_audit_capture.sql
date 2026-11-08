-- Harden admin mutation capture: MFA-only, safe snapshots, pinned search path.
create or replace function public.capture_admin_audit_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_claims jsonb := coalesce(auth.jwt(), '{}'::jsonb);
  v_old jsonb;
  v_new jsonb;
  v_source jsonb;
  v_safe_before jsonb := '{}'::jsonb;
  v_safe_after jsonb := '{}'::jsonb;
  v_key text;
  v_entity_id text;
  v_op text := lower(tg_op);
  v_action text;
  v_summary text;
  v_entity text := lower(tg_table_name);
  v_actor_email text;
begin
  if v_actor is distinct from '20e3df23-9f5a-4d88-8adc-093f75feb5df'::uuid then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  if coalesce(v_claims->>'aal', '') <> 'aal2' then
    raise exception 'MFA (AAL2) is required for administrative changes' using errcode = '42501';
  end if;
  v_actor_email := lower(coalesce(v_claims->>'email', 'theslyapex@gmail.com'));
  if tg_op <> 'INSERT' then v_old := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then v_new := to_jsonb(new); end if;
  v_source := coalesce(v_new, v_old);
  v_entity_id := coalesce(v_source->>'id', v_source->>'tld', v_source->>'user_id', v_source->>'request_id', v_source->>'slug');
  foreach v_key in array array[
    'status','moderation_status','is_approved','published','is_published','featured',
    'category','categories','progress','total_price','target_date','price_toman',
    'display_label','accent_color','is_pinned','message_type','deleted_at',
    'restriction_type','expires_at','revoked_at','resolved_at','decision',
    'rating','page_key','enabled','order_services','homepage_services',
    'starts_at','ends_at','discount_percent','purchase_count','points','event_type',
    'payment_status','status_key','is_featured','is_hidden','is_active'
  ] loop
    if v_old ? v_key then v_safe_before := v_safe_before || jsonb_build_object(v_key, v_old->v_key); end if;
    if v_new ? v_key then v_safe_after := v_safe_after || jsonb_build_object(v_key, v_new->v_key); end if;
  end loop;
  v_action := 'admin.' || v_entity || '.' || v_op;
  v_summary := case v_op
    when 'INSERT' then 'ایجاد یا افزودن رکورد در ماژول ' || v_entity
    when 'UPDATE' then 'ویرایش رکورد در ماژول ' || v_entity
    when 'DELETE' then 'حذف رکورد از ماژول ' || v_entity
    else 'تغییر در ماژول ' || v_entity
  end;
  insert into public.admin_audit_logs(
    actor_user_id, actor_email, action_key, entity_type, entity_id,
    summary, before_data, after_data, metadata
  ) values (
    v_actor, v_actor_email, v_action, v_entity, v_entity_id, v_summary,
    nullif(v_safe_before, '{}'::jsonb), nullif(v_safe_after, '{}'::jsonb),
    jsonb_build_object('source','database_trigger','table',tg_table_name,'operation',v_op,'auth_level','aal2')
  );
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;
revoke all on function public.capture_admin_audit_mutation() from public, anon, authenticated;
grant execute on function public.capture_admin_audit_mutation() to service_role;
