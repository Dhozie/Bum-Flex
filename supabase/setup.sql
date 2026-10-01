-- Run this file in the Supabase SQL Editor for the Bum Flex project.
create extension if not exists pgcrypto;

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price numeric(12, 2) not null check (price >= 0),
  image text not null,
  description text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null,
  customer_email text not null,
  customer_phone text not null,
  customer_address text not null,
  total_amount numeric(12, 2) not null check (total_amount >= 0),
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid not null references public.products(id),
  quantity integer not null check (quantity > 0),
  price numeric(12, 2) not null check (price >= 0),
  created_at timestamptz not null default now()
);

-- Stable IDs connect the current homepage products to their order line items.
insert into public.products (id, name, price, image, description) values
('10000000-0000-4000-8000-000000000001', 'Power Black Shorts', 1500, 'img/Black%20.png', 'Power Black Shorts, designed for comfortable movement and everyday style.'),
('10000000-0000-4000-8000-000000000002', 'Indigo Essential', 1500, 'img/Blue.png', 'Indigo Essential, designed for comfortable movement and everyday style.'),
('10000000-0000-4000-8000-000000000003', 'Mist fit', 1500, 'img/Gray.png', 'Mist fit, designed for comfortable movement and everyday style.'),
('10000000-0000-4000-8000-000000000004', 'Snow Fit', 1500, 'img/White.png', 'Snow Fit, designed for comfortable movement and everyday style.'),
('10000000-0000-4000-8000-000000000005', 'Blush Essential', 1500, 'img/Pink.png', 'Blush Essential, designed for comfortable movement and everyday style.'),
('10000000-0000-4000-8000-000000000006', 'Rose Classic', 1500, 'img/Pink%202.png', 'Rose Classic, designed for comfortable movement and everyday style.'),
('10000000-0000-4000-8000-000000000007', 'Black Essential', 1500, 'img/Black%202.png', 'Black Essential, designed for comfortable movement and everyday style.'),
('10000000-0000-4000-8000-000000000008', 'Savage Black', 1500, 'img/Black%203.png', 'Savage Black, designed for comfortable movement and everyday style.'),
('10000000-0000-4000-8000-000000000009', 'Denim Classic', 1500, 'img/Blue%202.png', 'Denim Classic, designed for comfortable movement and everyday style.')
on conflict (id) do update set
  name = excluded.name,
  price = excluded.price,
  image = excluded.image,
  description = excluded.description;

alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

drop policy if exists "Products are readable by everyone" on public.products;
create policy "Products are readable by everyone" on public.products
  for select to anon, authenticated using (true);

-- This function writes the parent and child rows as one transaction and uses
-- database product prices, so a browser cannot change the stored line prices.
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
begin
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

  insert into public.orders (customer_name, customer_email, customer_phone, customer_address, total_amount)
  values (trim(p_customer_name), trim(p_customer_email), trim(p_customer_phone), trim(p_customer_address), calculated_total)
  returning id into new_order_id;

  insert into public.order_items (order_id, product_id, quantity, price)
  select new_order_id, product.id, (item.value->>'quantity')::integer, product.price
    from jsonb_array_elements(p_items) as item(value)
    join public.products product on product.id = (item.value->>'product_id')::uuid;

  return new_order_id;
end;
$$;

revoke all on function public.place_bum_flex_order(text, text, text, text, numeric, jsonb) from public;
grant execute on function public.place_bum_flex_order(text, text, text, text, numeric, jsonb) to anon, authenticated;
grant select on public.products to anon, authenticated;
