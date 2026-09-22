\set ON_ERROR_STOP on

begin;

insert into public.beta_author_preregistrations (
  pen_name,
  email,
  email_normalized,
  status,
  visitor_key
) values
  (
    'Preopen Eligible',
    'Eligible.Author@example.com',
    'eligible.author@example.com',
    'preregistered',
    repeat('a', 32)
  ),
  (
    'Preopen Cancelled',
    'cancelled.author@example.com',
    'cancelled.author@example.com',
    'cancelled',
    repeat('b', 32)
  );

update public.beta_author_preregistration_config
   set state = 'AUTHOR_PREOPEN'
 where id = 1;

set local role supabase_auth_admin;
do $$
declare
  v_allowed jsonb;
  v_case_allowed jsonb;
  v_rejected jsonb;
  v_cancelled jsonb;
begin
  select public.hook_novelight_beta_signup_gate(
    '{"user":{"email":"eligible.author@example.com"}}'::jsonb
  ) into v_allowed;
  select public.hook_novelight_beta_signup_gate(
    '{"user":{"email":"ELIGIBLE.AUTHOR@EXAMPLE.COM"}}'::jsonb
  ) into v_case_allowed;
  select public.hook_novelight_beta_signup_gate(
    '{"user":{"email":"not-preregistered@example.com"}}'::jsonb
  ) into v_rejected;
  select public.hook_novelight_beta_signup_gate(
    '{"user":{"email":"cancelled.author@example.com"}}'::jsonb
  ) into v_cancelled;

  if v_allowed <> '{}'::jsonb or v_case_allowed <> '{}'::jsonb then
    raise exception 'AUTHOR_PREOPEN did not allow preregistered email';
  end if;

  if v_rejected #>> '{error,http_code}' <> '403'
     or v_cancelled #>> '{error,http_code}' <> '403' then
    raise exception 'AUTHOR_PREOPEN did not reject ineligible email';
  end if;
end
$$;

reset role;
update public.beta_author_preregistration_config
   set state = 'PRE_REGISTRATION'
 where id = 1;
set local role supabase_auth_admin;

do $$
declare
  v_response jsonb;
begin
  select public.hook_novelight_beta_signup_gate(
    '{"user":{"email":"eligible.author@example.com"}}'::jsonb
  ) into v_response;
  if v_response #>> '{error,http_code}' <> '403' then
    raise exception 'PRE_REGISTRATION must continue blocking Auth signup';
  end if;
end
$$;

reset role;
update public.beta_author_preregistration_config
   set state = 'BETA_OPEN'
 where id = 1;
set local role supabase_auth_admin;

do $$
declare
  v_response jsonb;
begin
  select public.hook_novelight_beta_signup_gate(
    '{"user":{"email":"anyone@example.com"}}'::jsonb
  ) into v_response;
  if v_response <> '{}'::jsonb then
    raise exception 'BETA_OPEN must allow ordinary Auth signup';
  end if;
end
$$;

rollback;

select 'PASS: beta-author preopen Auth behavior' as result;
