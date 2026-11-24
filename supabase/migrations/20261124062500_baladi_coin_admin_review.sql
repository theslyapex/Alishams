create or replace function public.baladi_admin_review_coin_request(
  p_request_id uuid,
  p_action text,
  p_admin_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_request public.baladi_coin_purchase_requests%rowtype;
  v_user_id uuid;
  v_balance bigint;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'forbidden';
  end if;
  if p_action not in ('approve','reject') then
    raise exception 'invalid action';
  end if;
  select * into v_request
  from public.baladi_coin_purchase_requests
  where id = p_request_id
  for update;
  if not found then raise exception 'درخواست پیدا نشد.'; end if;
  if v_request.status = 'approved' then
    raise exception 'این درخواست قبلاً تأیید و شارژ شده است.';
  end if;
  if v_request.status = 'rejected' then
    raise exception 'این درخواست قبلاً رد شده است.';
  end if;
  if p_action = 'reject' then
    update public.baladi_coin_purchase_requests
    set status = 'rejected', reviewed_at = now(), admin_note = left(coalesce(p_admin_note,''),1500)
    where id = p_request_id;
    return jsonb_build_object('ok',true,'status','rejected','request_code',v_request.request_code);
  end if;
  v_user_id := v_request.user_id;
  if v_user_id is null then
    select id into v_user_id from auth.users where lower(email)=lower(v_request.email) limit 1;
  end if;
  if v_user_id is null then raise exception 'برای ایمیل این درخواست حساب بازی پیدا نشد.'; end if;
  update public.baladi_game_profiles
  set coins = coins + v_request.coins, updated_at = now()
  where user_id = v_user_id
  returning coins into v_balance;
  if v_balance is null then raise exception 'پروفایل بازی این کاربر پیدا نشد.'; end if;
  insert into public.baladi_game_events(user_id,event_type,event_key,coin_delta,metadata,created_at)
  values (v_user_id,'coin_purchase_approved','coin-order:'||v_request.request_code,v_request.coins,
    jsonb_build_object('request_code',v_request.request_code,'amount_toman',v_request.amount_toman),now())
  on conflict do nothing;
  update public.baladi_coin_purchase_requests
  set status = 'approved', user_id = v_user_id, reviewed_at = now(), admin_note = left(coalesce(p_admin_note,''),1500)
  where id = p_request_id;
  return jsonb_build_object('ok',true,'status','approved','request_code',v_request.request_code,
    'coins_added',v_request.coins,'new_balance',v_balance);
end;
$$;
revoke all on function public.baladi_admin_review_coin_request(uuid,text,text) from public, anon, authenticated;
grant execute on function public.baladi_admin_review_coin_request(uuid,text,text) to service_role;
