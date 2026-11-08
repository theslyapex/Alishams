create unique index if not exists club_reward_vouchers_user_reward_once
on public.club_reward_vouchers(user_id, points_spent);

create or replace function public.club_redeem_points(
  p_user_id uuid,
  p_points integer,
  p_reward_toman integer
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_balance bigint;
  v_cost integer;
  v_code text;
begin
  if p_points not in (2500,10000,18000,25000) then
    raise exception 'invalid_reward';
  end if;

  v_cost := case p_points
    when 2500 then 155000
    when 10000 then 325000
    when 18000 then 725000
    when 25000 then 1450000
  end;

  if p_reward_toman <> v_cost then
    raise exception 'invalid_reward_value';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_user_id::text));

  if exists (
    select 1 from public.club_reward_vouchers
    where user_id = p_user_id and points_spent = p_points
  ) then
    raise exception 'reward_already_claimed';
  end if;

  select coalesce(sum(points),0) into v_balance
  from public.club_point_ledger
  where user_id = p_user_id;

  if v_balance < p_points then
    raise exception 'insufficient_points';
  end if;

  v_code := 'CLUB-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));

  insert into public.club_point_ledger(user_id,points,event_type,source_id,description)
  values(p_user_id,-p_points,'reward_redemption',v_code,'تبدیل امتیاز به اعتبار تخفیف '||v_cost::text||' تومانی');

  insert into public.club_reward_vouchers(user_id,code,points_spent,reward_toman)
  values(p_user_id,v_code,p_points,v_cost);

  return jsonb_build_object('ok',true,'code',v_code,'points_spent',p_points,'reward_toman',v_cost);
end
$function$;