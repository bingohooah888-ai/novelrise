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

insert into public.beta_author_invites (
  preregistration_id,
  token_version,
  token_hash,
  issued_at,
  expires_at,
  sent_at,
  delivery_status
) values
  (
    (
      select id
      from public.beta_author_preregistrations
      where email_normalized = 'eligible.author@example.com'
    ),
    1,
    encode(sha256(convert_to(repeat('a', 43), 'UTF8')), 'hex'),
    now(),
    now() + interval '30 days',
    now(),
    'accepted'
  ),
  (
    (
      select id
      from public.beta_author_preregistrations
      where email_normalized = 'cancelled.author@example.com'
    ),
    1,
    encode(sha256(convert_to(repeat('b', 43), 'UTF8')), 'hex'),
    now(),
    now() + interval '30 days',
    now(),
    'accepted'
  );

update public.beta_author_preregistration_config
   set state = 'AUTHOR_PREOPEN'
 where id = 1;

set local role supabase_auth_admin;
do $$
declare
  v_allowed jsonb;
  v_case_allowed jsonb;
  v_missing_token jsonb;
  v_wrong_token jsonb;
  v_unregistered jsonb;
  v_cancelled jsonb;
begin
  select public.hook_novelight_beta_signup_gate(
    jsonb_build_object(
      'user',
      jsonb_build_object(
        'email',
        'eligible.author@example.com',
        'user_metadata',
        jsonb_build_object(
          'novelight_invite_token',
          repeat('a', 43)
        )
      )
    )
  ) into v_allowed;

  select public.hook_novelight_beta_signup_gate(
    jsonb_build_object(
      'user',
      jsonb_build_object(
        'email',
        'ELIGIBLE.AUTHOR@EXAMPLE.COM',
        'user_metadata',
        jsonb_build_object(
          'novelight_invite_token',
          repeat('a', 43)
        )
      )
    )
  ) into v_case_allowed;

  select public.hook_novelight_beta_signup_gate(
    jsonb_build_object(
      'user',
      jsonb_build_object(
        'email',
        'eligible.author@example.com',
        'user_metadata',
        '{}'::jsonb
      )
    )
  ) into v_missing_token;

  select public.hook_novelight_beta_signup_gate(
    jsonb_build_object(
      'user',
      jsonb_build_object(
        'email',
        'eligible.author@example.com',
        'user_metadata',
        jsonb_build_object(
          'novelight_invite_token',
          repeat('c', 43)
        )
      )
    )
  ) into v_wrong_token;

  select public.hook_novelight_beta_signup_gate(
    jsonb_build_object(
      'user',
      jsonb_build_object(
        'email',
        'not-preregistered@example.com',
        'user_metadata',
        jsonb_build_object(
          'novelight_invite_token',
          repeat('a', 43)
        )
      )
    )
  ) into v_unregistered;

  select public.hook_novelight_beta_signup_gate(
    jsonb_build_object(
      'user',
      jsonb_build_object(
        'email',
        'cancelled.author@example.com',
        'user_metadata',
        jsonb_build_object(
          'novelight_invite_token',
          repeat('b', 43)
        )
      )
    )
  ) into v_cancelled;

  if v_allowed <> '{}'::jsonb or v_case_allowed <> '{}'::jsonb then
    raise exception 'AUTHOR_PREOPEN did not allow a valid email-delivered invite';
  end if;

  if v_missing_token #>> '{error,http_code}' <> '403'
     or v_wrong_token #>> '{error,http_code}' <> '403'
     or v_unregistered #>> '{error,http_code}' <> '403'
     or v_cancelled #>> '{error,http_code}' <> '403' then
    raise exception 'AUTHOR_PREOPEN did not reject invalid invite identity proof';
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
    jsonb_build_object(
      'user',
      jsonb_build_object(
        'email',
        'eligible.author@example.com',
        'user_metadata',
        jsonb_build_object(
          'novelight_invite_token',
          repeat('a', 43)
        )
      )
    )
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
  v_ordinary jsonb;
  v_reserved_without_invite jsonb;
  v_reserved_with_invite jsonb;
begin
  select public.hook_novelight_beta_signup_gate(
    '{"user":{"email":"anyone@example.com","user_metadata":{}}}'::jsonb
  ) into v_ordinary;

  select public.hook_novelight_beta_signup_gate(
    '{"user":{"email":"eligible.author@example.com","user_metadata":{}}}'::jsonb
  ) into v_reserved_without_invite;

  select public.hook_novelight_beta_signup_gate(
    jsonb_build_object(
      'user',
      jsonb_build_object(
        'email',
        'eligible.author@example.com',
        'user_metadata',
        jsonb_build_object(
          'novelight_invite_token',
          repeat('a', 43)
        )
      )
    )
  ) into v_reserved_with_invite;

  if v_ordinary <> '{}'::jsonb then
    raise exception 'BETA_OPEN must allow ordinary Auth signup';
  end if;

  if v_reserved_without_invite #>> '{error,http_code}' <> '403' then
    raise exception 'BETA_OPEN exposed a reserved preregistration to email-only takeover';
  end if;

  if v_reserved_with_invite <> '{}'::jsonb then
    raise exception 'BETA_OPEN rejected a valid reserved preregistration invite';
  end if;
end
$$;

rollback;

select 'PASS: secure beta-author invite Auth behavior' as result;
