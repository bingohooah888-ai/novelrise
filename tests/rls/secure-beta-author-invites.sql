\set ON_ERROR_STOP on

begin;

insert into public.beta_author_preregistrations (
  pen_name, email, email_normalized, source, visitor_key
) values
  (
    'Secure Invite Eligible',
    'secure-invite@example.com',
    'secure-invite@example.com',
    'direct',
    md5('secure-invite')
  ),
  (
    'Secure Invite Reserved',
    'secure-reserved@example.com',
    'secure-reserved@example.com',
    'direct',
    md5('secure-reserved')
  ),
  (
    'Secure Invite Cancelled',
    'secure-cancelled@example.com',
    'secure-cancelled@example.com',
    'direct',
    md5('secure-cancelled')
  );

update public.beta_author_preregistrations
   set status = 'cancelled'
 where email_normalized = 'secure-cancelled@example.com';

insert into public.beta_author_invites (
  preregistration_id,
  token_version,
  token_hash,
  issued_at,
  expires_at,
  sent_at,
  delivery_status
)
select
  p.id,
  1,
  encode(sha256(convert_to(repeat('a', 43), 'UTF8')), 'hex'),
  now(),
  now() + interval '30 days',
  now(),
  'accepted'
from public.beta_author_preregistrations p
where p.email_normalized = 'secure-invite@example.com';

insert into public.beta_author_invites (
  preregistration_id,
  token_version,
  token_hash,
  issued_at,
  expires_at,
  sent_at,
  delivery_status
)
select
  p.id,
  1,
  encode(sha256(convert_to(repeat('b', 43), 'UTF8')), 'hex'),
  now(),
  now() + interval '30 days',
  now(),
  'accepted'
from public.beta_author_preregistrations p
where p.email_normalized = 'secure-reserved@example.com';

insert into public.beta_author_invites (
  preregistration_id,
  token_version,
  token_hash,
  issued_at,
  expires_at,
  sent_at,
  delivery_status
)
select
  p.id,
  1,
  encode(sha256(convert_to(repeat('c', 43), 'UTF8')), 'hex'),
  now(),
  now() + interval '30 days',
  now(),
  'accepted'
from public.beta_author_preregistrations p
where p.email_normalized = 'secure-cancelled@example.com';

update public.beta_author_preregistration_config
   set state = 'AUTHOR_PREOPEN'
 where id = 1;

set local role supabase_auth_admin;

do $hook$
declare
  v_valid jsonb;
  v_missing jsonb;
  v_wrong jsonb;
  v_mismatch jsonb;
  v_cancelled jsonb;
begin
  select public.hook_novelight_beta_signup_gate(
    jsonb_build_object(
      'user',
      jsonb_build_object(
        'email', 'secure-invite@example.com',
        'user_metadata',
        jsonb_build_object(
          'novelight_invite_token',
          repeat('a', 43)
        )
      )
    )
  ) into v_valid;

  select public.hook_novelight_beta_signup_gate(
    '{"user":{"email":"secure-invite@example.com","user_metadata":{}}}'::jsonb
  ) into v_missing;

  select public.hook_novelight_beta_signup_gate(
    jsonb_build_object(
      'user',
      jsonb_build_object(
        'email', 'secure-invite@example.com',
        'user_metadata',
        jsonb_build_object(
          'novelight_invite_token',
          repeat('z', 43)
        )
      )
    )
  ) into v_wrong;

  select public.hook_novelight_beta_signup_gate(
    jsonb_build_object(
      'user',
      jsonb_build_object(
        'email', 'different@example.com',
        'user_metadata',
        jsonb_build_object(
          'novelight_invite_token',
          repeat('a', 43)
        )
      )
    )
  ) into v_mismatch;

  select public.hook_novelight_beta_signup_gate(
    jsonb_build_object(
      'user',
      jsonb_build_object(
        'email', 'secure-cancelled@example.com',
        'user_metadata',
        jsonb_build_object(
          'novelight_invite_token',
          repeat('c', 43)
        )
      )
    )
  ) into v_cancelled;

  if v_valid <> '{}'::jsonb then
    raise exception 'Valid AUTHOR_PREOPEN invite was rejected';
  end if;

  if v_missing #>> '{error,http_code}' <> '403'
     or v_wrong #>> '{error,http_code}' <> '403'
     or v_mismatch #>> '{error,http_code}' <> '403'
     or v_cancelled #>> '{error,http_code}' <> '403' then
    raise exception 'AUTHOR_PREOPEN accepted invalid invite identity proof';
  end if;
end
$hook$;

reset role;

do $before_insert$
declare
  v_prereg_id bigint;
  v_founding_number bigint;
begin
  select p.id, q.founding_number
    into v_prereg_id, v_founding_number
    from public.beta_author_preregistrations p
    join public.beta_author_founding_qualifications q
      on q.preregistration_id = p.id
   where p.email_normalized = 'secure-invite@example.com';

  if v_prereg_id is null or v_founding_number is null then
    raise exception 'Secure invite preregistration lacks immutable Founding number';
  end if;
end
$before_insert$;

insert into auth.users (
  id, email, created_at, raw_user_meta_data
) values (
  'fa000000-0000-4000-8000-000000000001',
  'secure-invite@example.com',
  timestamptz '2026-09-28 01:00:00+09',
  jsonb_build_object(
    'display_name', 'Secure Invite Eligible',
    'novelight_invite_token', repeat('a', 43)
  )
);

do $after_insert$
declare
  v_prereg_id bigint;
  v_founding_number bigint;
begin
  select p.id, q.founding_number
    into v_prereg_id, v_founding_number
    from public.beta_author_preregistrations p
    join public.beta_author_founding_qualifications q
      on q.preregistration_id = p.id
   where p.email_normalized = 'secure-invite@example.com';

  if not exists (
    select 1
    from public.beta_author_preregistrations p
    where p.id = v_prereg_id
      and p.auth_user_id = 'fa000000-0000-4000-8000-000000000001'
      and p.email_verified
      and p.status = 'registered'
      and p.registered_at is not null
  ) then
    raise exception 'Invite consumption did not bind and verify preregistration';
  end if;

  if not exists (
    select 1
    from public.beta_author_invites i
    where i.preregistration_id = v_prereg_id
      and i.consumed_at is not null
      and i.redeemed_auth_user_id = 'fa000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'Invite ledger was not consumed';
  end if;

  if exists (
    select 1
    from auth.users u
    where u.id = 'fa000000-0000-4000-8000-000000000001'
      and u.raw_user_meta_data ? 'novelight_invite_token'
  ) then
    raise exception 'Raw invite bearer remained in auth.users metadata';
  end if;

  if not exists (
    select 1
    from public.founding_authors f
    where f.author_id = 'fa000000-0000-4000-8000-000000000001'
      and f.founding_number = v_founding_number
  ) then
    raise exception 'Invite-bound Auth user did not receive original Founding number';
  end if;
end
$after_insert$;

-- Existing Auth email values must not auto-claim future preregistrations.
insert into auth.users (
  id, email, created_at, raw_user_meta_data
) values (
  'fa000000-0000-4000-8000-000000000002',
  'preexisting-auth@example.com',
  timestamptz '2026-09-30 01:00:00+09',
  '{"display_name":"Preexisting Auth"}'::jsonb
);

insert into public.beta_author_preregistrations (
  pen_name, email, email_normalized, source, visitor_key
) values (
  'Preexisting Auth',
  'preexisting-auth@example.com',
  'preexisting-auth@example.com',
  'direct',
  md5('preexisting-auth')
);

do $no_email_claim$
begin
  if exists (
    select 1
    from public.beta_author_preregistrations p
    where p.email_normalized = 'preexisting-auth@example.com'
      and p.auth_user_id is not null
  ) or exists (
    select 1
    from public.founding_authors f
    where f.author_id = 'fa000000-0000-4000-8000-000000000002'
  ) then
    raise exception 'Email value alone claimed a preregistration identity';
  end if;
end
$no_email_claim$;

update public.beta_author_preregistration_config
   set state = 'BETA_OPEN'
 where id = 1;

set local role supabase_auth_admin;

do $beta_open$
declare
  v_ordinary jsonb;
  v_reserved_without_invite jsonb;
  v_reserved_with_invite jsonb;
begin
  select public.hook_novelight_beta_signup_gate(
    '{"user":{"email":"ordinary-reader@example.com","user_metadata":{}}}'::jsonb
  ) into v_ordinary;

  select public.hook_novelight_beta_signup_gate(
    '{"user":{"email":"secure-reserved@example.com","user_metadata":{}}}'::jsonb
  ) into v_reserved_without_invite;

  select public.hook_novelight_beta_signup_gate(
    jsonb_build_object(
      'user',
      jsonb_build_object(
        'email', 'secure-reserved@example.com',
        'user_metadata',
        jsonb_build_object(
          'novelight_invite_token',
          repeat('b', 43)
        )
      )
    )
  ) into v_reserved_with_invite;

  if v_ordinary <> '{}'::jsonb then
    raise exception 'BETA_OPEN rejected an ordinary new signup';
  end if;

  if v_reserved_without_invite #>> '{error,http_code}' <> '403' then
    raise exception 'BETA_OPEN allowed email-only takeover of reserved preregistration';
  end if;

  if v_reserved_with_invite <> '{}'::jsonb then
    raise exception 'BETA_OPEN rejected valid reserved invite';
  end if;
end
$beta_open$;

reset role;

-- Account deletion preserves the Founding number but requires a fresh invite to relink.
delete from auth.users
 where id = 'fa000000-0000-4000-8000-000000000001';

do $after_delete$
begin
  if exists (
    select 1
    from public.beta_author_preregistrations p
    where p.email_normalized = 'secure-invite@example.com'
      and p.auth_user_id is not null
  ) then
    raise exception 'Deleted Auth account remained linked to preregistration';
  end if;

  if exists (
    select 1
    from public.founding_authors f
    where f.author_id = 'fa000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'Deleted Auth account remained Founding eligible';
  end if;
end
$after_delete$;

update public.beta_author_invites i
set
  token_version = token_version + 1,
  token_hash = encode(sha256(convert_to(repeat('r', 43), 'UTF8')), 'hex'),
  issued_at = now(),
  expires_at = now() + interval '30 days',
  sent_at = now(),
  consumed_at = null,
  redeemed_auth_user_id = null,
  revoked_at = null,
  resend_email_id = null,
  delivery_status = 'accepted',
  updated_at = now()
where i.preregistration_id = (
  select p.id
  from public.beta_author_preregistrations p
  where p.email_normalized = 'secure-invite@example.com'
);

insert into auth.users (
  id, email, created_at, raw_user_meta_data
) values (
  'fa000000-0000-4000-8000-000000000003',
  'secure-invite@example.com',
  timestamptz '2026-10-01 01:00:00+09',
  jsonb_build_object(
    'display_name', 'Secure Invite Return',
    'novelight_invite_token', repeat('r', 43)
  )
);

do $relinked$
declare
  v_expected_number bigint;
begin
  select q.founding_number
    into v_expected_number
    from public.beta_author_preregistrations p
    join public.beta_author_founding_qualifications q
      on q.preregistration_id = p.id
   where p.email_normalized = 'secure-invite@example.com';

  if not exists (
    select 1
    from public.beta_author_preregistrations p
    where p.email_normalized = 'secure-invite@example.com'
      and p.auth_user_id = 'fa000000-0000-4000-8000-000000000003'
  ) then
    raise exception 'Fresh invite did not relink returning preregistered author';
  end if;

  if not exists (
    select 1
    from public.founding_authors f
    where f.author_id = 'fa000000-0000-4000-8000-000000000003'
      and f.founding_number = v_expected_number
  ) then
    raise exception 'Returning author did not recover original Founding number';
  end if;
end
$relinked$;

rollback;

select 'PASS: secure preregistration invite identity linkage' as result;
