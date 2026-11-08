-- Capture direct admin-only mutations from management modules in the append-only audit trail.
create or replace function public.capture_admin_audit_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
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
  v_actor_email text := 'theslyapex@gmail.com';
begin
  -- Only the explicitly authorized administrator is recorded by this trigger.
  if v_actor is distinct from '20e3df23-9f5a-4d88-8adc-093f75feb5df'::uuid then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  if tg_op <> 'INSERT' then v_old := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then v_new := to_jsonb(new); end if;

  v_source := coalesce(v_new, v_old);
  v_entity_id := coalesce(v_source->>'id', v_source->>'tld', v_source->>'user_id', v_source->>'request_id', v_source->>'slug');

  foreach v_key in array array[
    'status','moderation_status','is_approved','published','is_published','featured',
    'category','categories','title','description','progress','total_price','target_date',
    'price_toman','display_label','accent_color','is_pinned','message_type','deleted_at',
    'restriction_type','expires_at','revoked_at','resolved_at','decision','admin_note',
    'rating','page_key','enabled','order_services','homepage_services','display_name',
    'starts_at','ends_at','discount_percent','purchase_count','points','event_type',
    'payment_status','customer_rating','sender_type','subject','status_key'
  ] loop
    if v_old ? v_key then v_safe_before := v_safe_before || jsonb_build_object(v_key, v_old->v_key); end if;
    if v_new ? v_key then v_safe_after := v_safe_after || jsonb_build_object(v_key, v_new->v_key); end if;
  end loop;

  v_action := 'admin.' || v_entity || '.' || lower(v_op);
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
    v_actor, v_actor_email, v_action, v_entity, v_entity_id,
    v_summary,
    nullif(v_safe_before, '{}'::jsonb),
    nullif(v_safe_after, '{}'::jsonb),
    jsonb_build_object('source','database_trigger','table',tg_table_name,'operation',v_op)
  );

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

revoke all on function public.capture_admin_audit_mutation() from public, anon, authenticated;
grant execute on function public.capture_admin_audit_mutation() to service_role;

do $$
declare
  t text;
  tables text[] := array[
    'site_comments','site_feedback','portfolio_items','studio_videos','domain_pricing',
    'community_messages','community_message_reports','community_user_restrictions',
    'site_service_settings','communication_requests','communication_messages',
    'user_profiles','account_level_verifications','account_notifications',
    'referral_codes','referral_rewards','newsletter_subscribers',
    'club_profiles','club_reward_vouchers','plus_memberships',
    'plus_domain_requests','plus_reel_requests','plus_payment_intents'
  ];
begin
  foreach t in array tables loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists audit_admin_mutation on public.%I', t);
      execute format(
        'create trigger audit_admin_mutation after insert or update or delete on public.%I for each row execute function public.capture_admin_audit_mutation()',
        t
      );
    end if;
  end loop;
end $$;
