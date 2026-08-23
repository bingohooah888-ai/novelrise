\set ON_ERROR_STOP on

create table if not exists auth.users (
  id uuid primary key,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);

create table public.profiles (
  id uuid primary key,
  display_name text,
  bio text,
  plan text not null,
  payment_status text,
  stripe_customer_id text
);

grant select, update on public.profiles to authenticated;

insert into auth.users (id, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', '{"display_name":"Author A"}'::jsonb),
  ('22222222-2222-2222-2222-222222222222', '{"display_name":"Author B"}'::jsonb),
  ('33333333-3333-3333-3333-333333333333', '{"display_name":"Free Author"}'::jsonb),
  ('44444444-4444-4444-4444-444444444444', '{"display_name":"Standard Author"}'::jsonb),
  ('55555555-5555-5555-5555-555555555555', '{"display_name":"Premium Author"}'::jsonb),
  ('66666666-6666-6666-6666-666666666666', '{"display_name":"Concurrent Free"}'::jsonb),
  ('77777777-7777-7777-7777-777777777777', '{"display_name":"登録テスト"}'::jsonb);

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
  ('66666666-6666-6666-6666-666666666666', 'Concurrent Free', '', 'free', 'active', 'cus_concurrent'),
  ('77777777-7777-7777-7777-777777777777', null, '', 'free', 'active', null);
