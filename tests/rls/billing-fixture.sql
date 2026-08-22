\set ON_ERROR_STOP on

create table public.profiles (
  id uuid primary key,
  display_name text,
  bio text,
  plan text not null,
  payment_status text,
  stripe_customer_id text
);

grant select, update on public.profiles to authenticated;

insert into public.profiles (
  id,
  display_name,
  bio,
  plan,
  payment_status,
  stripe_customer_id
) values
  ('11111111-1111-1111-1111-111111111111', 'Author A', '', 'premium', 'active', 'cus_author_a'),
  ('22222222-2222-2222-2222-222222222222', 'Author B', '', 'premium', 'active', 'cus_author_b'),
  ('33333333-3333-3333-3333-333333333333', 'Free Author', '', 'free', 'active', 'cus_free'),
  ('44444444-4444-4444-4444-444444444444', 'Standard Author', '', 'standard', 'active', 'cus_standard'),
  ('55555555-5555-5555-5555-555555555555', 'Premium Author', '', 'premium', 'active', 'cus_premium'),
  ('66666666-6666-6666-6666-666666666666', 'Concurrent Free', '', 'free', 'active', 'cus_concurrent');
