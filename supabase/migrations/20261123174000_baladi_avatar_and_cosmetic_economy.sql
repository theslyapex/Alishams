alter table public.baladi_game_profiles
  add column if not exists avatar_path text,
  add column if not exists avatar_unlocked boolean not null default false,
  add column if not exists equipped_frame_id text not null default 'frame_default',
  add column if not exists wins integer not null default 0,
  add column if not exists losses integer not null default 0,
  add column if not exists chat_unlocked_at timestamptz;

create table if not exists public.baladi_cosmetic_catalog (
  id text primary key,
  kind text not null check (kind in ('avatar_unlock','frame','sticker')),
  display_name text not null check (char_length(display_name) between 2 and 48),
  price_coins integer not null check (price_coins >= 0 and price_coins <= 15000),
  asset_path text not null,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.baladi_user_cosmetics (
  user_id uuid not null references auth.users(id) on delete cascade,
  cosmetic_id text not null references public.baladi_cosmetic_catalog(id),
  purchased_at timestamptz not null default now(),
  primary key (user_id, cosmetic_id)
);

alter table public.baladi_cosmetic_catalog enable row level security;
alter table public.baladi_user_cosmetics enable row level security;

insert into public.baladi_cosmetic_catalog
  (id, kind, display_name, price_coins, asset_path, sort_order)
values
  ('avatar_unlock', 'avatar_unlock', 'فعال‌سازی تصویر پروفایل', 7000, 'avatar/upload', 0),
  ('frame_default', 'frame', 'قاب کلاسیک', 0, 'frames/default.svg', 1),
  ('frame_copper', 'frame', 'قاب مسی', 1000, 'frames/copper.svg', 2),
  ('frame_silver', 'frame', 'قاب نقره‌ای', 2500, 'frames/silver.svg', 3),
  ('frame_turquoise', 'frame', 'قاب فیروزه‌ای', 5000, 'frames/turquoise.svg', 4),
  ('frame_royal', 'frame', 'قاب شاهانه', 9000, 'frames/royal.svg', 5),
  ('frame_legend', 'frame', 'قاب افسانه‌ای', 15000, 'frames/legend.svg', 6)
on conflict (id) do update set
  display_name = excluded.display_name,
  price_coins = excluded.price_coins,
  asset_path = excluded.asset_path,
  sort_order = excluded.sort_order,
  is_active = true;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'baladi_game_profiles_equipped_frame_fk'
      and conrelid = 'public.baladi_game_profiles'::regclass
  ) then
    alter table public.baladi_game_profiles
      add constraint baladi_game_profiles_equipped_frame_fk
      foreign key (equipped_frame_id)
      references public.baladi_cosmetic_catalog(id);
  end if;
end $$;

insert into public.baladi_user_cosmetics(user_id, cosmetic_id)
select user_id, 'frame_default' from public.baladi_game_profiles
on conflict do nothing;

create or replace function public.baladi_purchase_cosmetic(p_user_id uuid, p_cosmetic_id text)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_item public.baladi_cosmetic_catalog%rowtype;
  v_profile public.baladi_game_profiles%rowtype;
begin
  select * into v_item
  from public.baladi_cosmetic_catalog
  where id = p_cosmetic_id and is_active = true
  for share;

  if not found then raise exception 'این کالا در فروشگاه موجود نیست.'; end if;

  select * into v_profile
  from public.baladi_game_profiles
  where user_id = p_user_id
  for update;

  if not found then raise exception 'پروفایل بازی پیدا نشد.'; end if;

  if exists (
    select 1 from public.baladi_user_cosmetics
    where user_id = p_user_id and cosmetic_id = p_cosmetic_id
  ) then
    raise exception 'این کالا را قبلاً خریده‌ای.';
  end if;

  if v_profile.coins < v_item.price_coins then
    raise exception 'سکه کافی برای خرید این کالا نداری.';
  end if;

  update public.baladi_game_profiles
  set coins = coins - v_item.price_coins,
      avatar_unlocked = case when v_item.kind = 'avatar_unlock' then true else avatar_unlocked end,
      updated_at = now()
  where user_id = p_user_id
  returning * into v_profile;

  insert into public.baladi_user_cosmetics(user_id, cosmetic_id)
  values (p_user_id, p_cosmetic_id);

  return jsonb_build_object(
    'profile', to_jsonb(v_profile),
    'item', jsonb_build_object(
      'id', v_item.id, 'kind', v_item.kind,
      'display_name', v_item.display_name,
      'price_coins', v_item.price_coins,
      'asset_path', v_item.asset_path
    )
  );
end;
$$;

create or replace function public.baladi_equip_frame(p_user_id uuid, p_frame_id text)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_profile public.baladi_game_profiles%rowtype;
begin
  if not exists (
    select 1 from public.baladi_cosmetic_catalog
    where id = p_frame_id and kind = 'frame' and is_active = true
  ) then raise exception 'قاب انتخاب‌شده معتبر نیست.'; end if;

  if not exists (
    select 1 from public.baladi_user_cosmetics
    where user_id = p_user_id and cosmetic_id = p_frame_id
  ) then raise exception 'ابتدا باید این قاب را خریداری کنی.'; end if;

  update public.baladi_game_profiles
  set equipped_frame_id = p_frame_id, updated_at = now()
  where user_id = p_user_id
  returning * into v_profile;

  if not found then raise exception 'پروفایل بازی پیدا نشد.'; end if;
  return to_jsonb(v_profile);
end;
$$;

revoke all on function public.baladi_purchase_cosmetic(uuid, text) from public, anon, authenticated;
grant execute on function public.baladi_purchase_cosmetic(uuid, text) to service_role;
revoke all on function public.baladi_equip_frame(uuid, text) from public, anon, authenticated;
grant execute on function public.baladi_equip_frame(uuid, text) to service_role;