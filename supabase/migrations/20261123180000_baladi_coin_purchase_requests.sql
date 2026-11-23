create table if not exists public.baladi_coin_purchase_requests (
  id uuid primary key default gen_random_uuid(),
  request_code text not null unique,
  user_id uuid references auth.users(id) on delete set null,
  full_name text not null check (char_length(trim(full_name)) between 2 and 80),
  email text not null check (char_length(email) <= 254),
  phone text not null check (char_length(phone) between 8 and 20),
  coins integer not null check (coins between 1000 and 100000 and coins % 1000 = 0),
  amount_toman integer not null check (amount_toman = (coins / 1000) * 8900),
  transaction_reference text not null default '' check (char_length(transaction_reference) <= 120),
  description text not null default '' check (char_length(description) <= 1500),
  receipt_path text not null,
  status text not null default 'pending' check (status in ('pending','reviewing','approved','rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  admin_note text not null default ''
);
alter table public.baladi_coin_purchase_requests enable row level security;
revoke all on public.baladi_coin_purchase_requests from anon, authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('baladi-coin-receipts','baladi-coin-receipts',false,5242880,array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict(id) do update set public=false,file_size_limit=5242880,allowed_mime_types=excluded.allowed_mime_types;