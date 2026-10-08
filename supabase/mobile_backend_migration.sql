-- Shared, user-owned cart and order access for the Bum Flex website and mobile app.
-- Apply after supabase/setup.sql. Existing orders are retained with user_id = NULL.

create table if not exists public.carts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cart_items (
  cart_id uuid not null references public.carts(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  updated_at timestamptz not null default now(),
  primary key (cart_id, product_id)
);

create index if not exists cart_items_product_id_idx on public.cart_items(product_id);
alter table public.orders add column if not exists user_id uuid references auth.users(id) on delete set null;
create index if not exists orders_user_id_created_at_idx on public.orders(user_id, created_at desc);

alter table public.carts enable row level security;
alter table public.cart_items enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

drop policy if exists "Users manage their own cart" on public.carts;
create policy "Users manage their own cart" on public.carts
  for all to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "Users manage their own cart items" on public.cart_items;
create policy "Users manage their own cart items" on public.cart_items
  for all to authenticated
  using (exists (select 1 from public.carts c where c.id = cart_id and c.user_id = (select auth.uid())))
  with check (exists (select 1 from public.carts c where c.id = cart_id and c.user_id = (select auth.uid())));

drop policy if exists "Users read their own orders" on public.orders;
create policy "Users read their own orders" on public.orders
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "Users read items from their own orders" on public.order_items;
create policy "Users read items from their own orders" on public.order_items
  for select to authenticated using (
    exists (select 1 from public.orders o where o.id = order_id and o.user_id = (select auth.uid()))
  );

create or replace function public.place_bum_flex_order(
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text,
  p_customer_address text,
  p_total_amount numeric,
  p_items jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_order_id uuid;
  calculated_total numeric(12, 2);
  authenticated_user_id uuid := auth.uid();
begin
  if authenticated_user_id is null then
    raise exception 'Authentication is required to place an order.';
  end if;
  if coalesce(trim(p_customer_name), '') = ''
    or coalesce(trim(p_customer_email), '') = ''
    or coalesce(trim(p_customer_phone), '') = ''
    or coalesce(trim(p_customer_address), '') = '' then
    raise exception 'Customer details are required.';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'At least one order item is required.';
  end if;

  select sum(product.price * (item.value->>'quantity')::integer)
    into calculated_total
    from jsonb_array_elements(p_items) as item(value)
    join public.products product on product.id = (item.value->>'product_id')::uuid
    where (item.value->>'quantity')::integer > 0;
  if calculated_total is null or calculated_total <> p_total_amount then
    raise exception 'Order total does not match the current product prices.';
  end if;

  insert into public.orders (user_id, customer_name, customer_email, customer_phone, customer_address, total_amount)
  values (authenticated_user_id, trim(p_customer_name), trim(p_customer_email), trim(p_customer_phone), trim(p_customer_address), calculated_total)
  returning id into new_order_id;

  insert into public.order_items (order_id, product_id, quantity, price)
  select new_order_id, product.id, (item.value->>'quantity')::integer, product.price
    from jsonb_array_elements(p_items) as item(value)
    join public.products product on product.id = (item.value->>'product_id')::uuid;

  return new_order_id;
end;
$$;

revoke all on function public.place_bum_flex_order(text, text, text, text, numeric, jsonb) from public, anon;
grant execute on function public.place_bum_flex_order(text, text, text, text, numeric, jsonb) to authenticated;

grant select, insert, update, delete on public.carts, public.cart_items to authenticated;
grant select on public.orders, public.order_items to authenticated;

-- Enable live cross-device cart updates when Supabase Realtime is available.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'cart_items'
    ) then
      alter publication supabase_realtime add table public.cart_items;
    end if;
  end if;
end;
$$;
