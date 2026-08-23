\set ON_ERROR_STOP on

select public.test_assert(
  (select display_name from public.profiles where id = '77777777-7777-7777-7777-777777777777') = '登録テスト',
  'signup display name is backfilled from auth user metadata'
);

insert into auth.users (id, raw_user_meta_data)
values ('88888888-8888-8888-8888-888888888888', '{"display_name":"新規登録名"}'::jsonb);

insert into public.profiles (
  id,
  display_name,
  bio,
  plan,
  payment_status,
  stripe_customer_id
) values (
  '88888888-8888-8888-8888-888888888888',
  null,
  '',
  'free',
  'active',
  null
);

select public.test_assert(
  (select display_name from public.profiles where id = '88888888-8888-8888-8888-888888888888') = '新規登録名',
  'future profile inserts inherit signup display name'
);
