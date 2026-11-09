alter table public.client_orders
  add column if not exists user_id uuid references auth.users(id) on delete set null;
create index if not exists client_orders_user_created_at_idx
  on public.client_orders (user_id, created_at desc)
  where user_id is not null;
drop policy if exists client_orders_select_own on public.client_orders;
create policy client_orders_select_own on public.client_orders
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists client_order_events_select_own on public.client_order_events;
create policy client_order_events_select_own on public.client_order_events
  for select to authenticated using (
    exists (select 1 from public.client_orders o
      where o.id = client_order_events.order_id
        and o.user_id = (select auth.uid()))
  );
revoke all on table public.client_orders from anon, authenticated;
revoke all on table public.client_order_events from anon, authenticated;
grant select (
  id, tracking_code, service, services, title, details, budget, status,
  quoted_price, eta_date, public_message, project_id, created_at, updated_at,
  discount_percent, discount_amount, payable_amount, offer_accepted_at,
  offer_terms_version, early_start_consent
) on public.client_orders to authenticated;
grant select (id, order_id, status, public_message, created_at)
  on public.client_order_events to authenticated;
