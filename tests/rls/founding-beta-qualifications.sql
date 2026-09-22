\set ON_ERROR_STOP on

begin;

do $test$
declare
  v_prereg_one bigint;
  v_prereg_over_100 bigint;
  v_prereg_internal bigint;
  v_number_one bigint;
  v_number_over_100 bigint;
  v_allocator_before bigint;
  v_allocator_after bigint;
  v_beta_qualified_at timestamptz;
  v_metrics record;
begin
  insert into public.beta_author_preregistrations (
    pen_name, email, email_normalized, source, visitor_key, created_at
  ) values (
    'Founding One',
    'founding-one@example.com',
    'founding-one@example.com',
    'direct',
    md5('founding-one'),
    timestamptz '2026-09-20 10:00:00+09'
  )
  returning id into v_prereg_one;

  select q.founding_number
  into v_number_one
  from public.beta_author_founding_qualifications q
  where q.preregistration_id = v_prereg_one;

  if v_number_one is null or v_number_one <= 0 then
    raise exception 'New preregistration did not receive a permanent Founding number';
  end if;

  update public.beta_author_founding_number_allocator
  set last_number = greatest(last_number, 100)
  where id = 1;

  insert into public.beta_author_preregistrations (
    pen_name, email, email_normalized, source, visitor_key, created_at
  ) values (
    'Founding Over 100',
    'founding-over-100@example.com',
    'founding-over-100@example.com',
    'direct',
    md5('founding-over-100'),
    timestamptz '2026-09-20 10:01:00+09'
  )
  returning id into v_prereg_over_100;

  select q.founding_number
  into v_number_over_100
  from public.beta_author_founding_qualifications q
  where q.preregistration_id = v_prereg_over_100;

  if v_number_over_100 <= 100 then
    raise exception 'Founding numbering still stops at 100';
  end if;

  select last_number into v_allocator_before
  from public.beta_author_founding_number_allocator
  where id = 1;

  begin
    insert into public.beta_author_preregistrations (
      pen_name, email, email_normalized, source, visitor_key
    ) values (
      'Duplicate Founding',
      'founding-over-100@example.com',
      'founding-over-100@example.com',
      'direct',
      md5('founding-duplicate')
    );
    raise exception 'Duplicate preregistration unexpectedly succeeded';
  exception
    when unique_violation then null;
  end;

  select last_number into v_allocator_after
  from public.beta_author_founding_number_allocator
  where id = 1;

  if v_allocator_after is distinct from v_allocator_before then
    raise exception 'Duplicate preregistration consumed a Founding number';
  end if;

  insert into public.beta_author_invites (
    preregistration_id,
    token_version,
    token_hash,
    issued_at,
    expires_at,
    sent_at,
    delivery_status
  ) values (
    v_prereg_one,
    1,
    encode(sha256(convert_to(repeat('f', 43), 'UTF8')), 'hex'),
    timestamptz '2026-09-27 20:00:00+09',
    timestamptz '2026-10-27 20:00:00+09',
    timestamptz '2026-09-27 20:00:00+09',
    'accepted'
  );

  insert into auth.users (
    id, email, created_at, raw_user_meta_data
  ) values (
    'fb000000-0000-4000-8000-000000000001',
    'founding-one@example.com',
    timestamptz '2026-09-28 01:00:00+09',
    jsonb_build_object(
      'display_name',
      'Founding One',
      'novelight_invite_token',
      repeat('f', 43)
    )
  );

  if not exists (
    select 1
    from public.founding_authors f
    where f.author_id = 'fb000000-0000-4000-8000-000000000001'
      and f.founding_number = v_number_one
      and f.qualifying_novel_id is null
  ) then
    raise exception 'Invited preregistered Auth signup did not receive its original Founding number';
  end if;

  if not exists (
    select 1
    from public.beta_author_preregistrations p
    where p.id = v_prereg_one
      and p.auth_user_id = 'fb000000-0000-4000-8000-000000000001'
      and p.email_verified
      and p.status = 'registered'
  ) then
    raise exception 'Secure invite did not explicitly bind and verify the preregistration';
  end if;

  if not exists (
    select 1
    from public.beta_author_invites i
    where i.preregistration_id = v_prereg_one
      and i.consumed_at is not null
      and i.redeemed_auth_user_id = 'fb000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'Secure invite was not consumed by the Auth signup';
  end if;

  if exists (
    select 1
    from auth.users u
    where u.id = 'fb000000-0000-4000-8000-000000000001'
      and u.raw_user_meta_data ? 'novelight_invite_token'
  ) then
    raise exception 'Raw invite bearer leaked into persisted Auth user metadata';
  end if;

  if not exists (
    select 1
    from public.beta_participants b
    where b.auth_user_id = 'fb000000-0000-4000-8000-000000000001'
      and b.email_normalized = 'founding-one@example.com'
  ) then
    raise exception 'Preopen signup did not receive beta participant qualification';
  end if;

  select b.qualified_at
  into v_beta_qualified_at
  from public.beta_participants b
  where b.auth_user_id = 'fb000000-0000-4000-8000-000000000001';

  update public.beta_author_preregistrations
  set status = 'cancelled'
  where id = v_prereg_one;

  if exists (
    select 1 from public.founding_authors
    where author_id = 'fb000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'Cancelled preregistration remained Founding badge eligible';
  end if;

  update public.beta_author_preregistrations
  set status = 'preregistered'
  where id = v_prereg_one;

  if not exists (
    select 1 from public.founding_authors
    where author_id = 'fb000000-0000-4000-8000-000000000001'
      and founding_number = v_number_one
  ) then
    raise exception 'Restored preregistration did not recover the same permanent Founding number';
  end if;

  insert into public.beta_author_preregistrations (
    pen_name, email, email_normalized, source, visitor_key
  ) values (
    'Internal Test',
    'internal-participant@example.com',
    'internal-participant@example.com',
    'direct',
    md5('internal-participant')
  )
  returning id into v_prereg_internal;

  insert into auth.users (
    id, email, created_at, raw_user_meta_data, raw_app_meta_data
  ) values (
    'fb000000-0000-4000-8000-000000000002',
    'internal-participant@example.com',
    timestamptz '2026-09-30 01:00:00+09',
    '{"display_name":"Internal"}'::jsonb,
    '{"internal_e2e":true}'::jsonb
  );

  if exists (
    select 1 from public.founding_authors
    where author_id = 'fb000000-0000-4000-8000-000000000002'
  ) or exists (
    select 1 from public.beta_participants
    where auth_user_id = 'fb000000-0000-4000-8000-000000000002'
  ) then
    raise exception 'Internal E2E account leaked into participation qualifications';
  end if;

  insert into auth.users (
    id, email, created_at, raw_user_meta_data
  ) values (
    'fb000000-0000-4000-8000-000000000006',
    'metadata-spoof@example.com',
    timestamptz '2026-09-30 01:30:00+09',
    '{"display_name":"Metadata Spoof","internal_e2e":true}'::jsonb
  );

  if not exists (
    select 1 from public.beta_participants
    where auth_user_id = 'fb000000-0000-4000-8000-000000000006'
  ) then
    raise exception 'User-editable metadata incorrectly excluded a real beta participant';
  end if;

  insert into auth.users (
    id, email, created_at, raw_user_meta_data
  ) values (
    'fb000000-0000-4000-8000-000000000003',
    'beta-only@example.com',
    timestamptz '2026-09-30 02:00:00+09',
    '{"display_name":"Beta Only"}'::jsonb
  );

  if not exists (
    select 1 from public.beta_participants
    where auth_user_id = 'fb000000-0000-4000-8000-000000000003'
  ) or exists (
    select 1 from public.founding_authors
    where author_id = 'fb000000-0000-4000-8000-000000000003'
  ) then
    raise exception 'Beta-only user qualification is not separate from Founding Author';
  end if;

  insert into auth.users (
    id, email, created_at, raw_user_meta_data
  ) values (
    'fb000000-0000-4000-8000-000000000004',
    'pre-beta@example.com',
    timestamptz '2026-09-27 23:59:00+09',
    '{"display_name":"Pre Beta"}'::jsonb
  );

  if exists (
    select 1 from public.beta_participants
    where auth_user_id = 'fb000000-0000-4000-8000-000000000004'
  ) then
    raise exception 'Pre-beta account incorrectly received beta participant qualification';
  end if;

  delete from auth.users
  where id = 'fb000000-0000-4000-8000-000000000001';

  if exists (
    select 1 from public.founding_authors
    where author_id = 'fb000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'Deleted account remained Founding badge eligible';
  end if;

  if not exists (
    select 1 from public.beta_participants
    where email_normalized = 'founding-one@example.com'
      and auth_user_id is null
      and qualified_at = v_beta_qualified_at
  ) then
    raise exception 'Account deletion lost permanent beta participation history';
  end if;

  update public.beta_author_invites
  set
    token_version = token_version + 1,
    token_hash = encode(
      sha256(convert_to(repeat('r', 43), 'UTF8')),
      'hex'
    ),
    issued_at = timestamptz '2026-10-01 00:30:00+09',
    expires_at = timestamptz '2026-10-31 00:30:00+09',
    sent_at = timestamptz '2026-10-01 00:30:00+09',
    consumed_at = null,
    redeemed_auth_user_id = null,
    revoked_at = null,
    resend_email_id = null,
    delivery_status = 'accepted',
    updated_at = timestamptz '2026-10-01 00:30:00+09'
  where preregistration_id = v_prereg_one;

  insert into auth.users (
    id, email, created_at, raw_user_meta_data
  ) values (
    'fb000000-0000-4000-8000-000000000005',
    'founding-one@example.com',
    timestamptz '2026-10-01 01:00:00+09',
    jsonb_build_object(
      'display_name',
      'Founding One Return',
      'novelight_invite_token',
      repeat('r', 43)
    )
  );

  if not exists (
    select 1 from public.founding_authors
    where author_id = 'fb000000-0000-4000-8000-000000000005'
      and founding_number = v_number_one
  ) then
    raise exception 'Returning preregistered user did not recover the original Founding number';
  end if;

  if not exists (
    select 1 from public.beta_participants
    where auth_user_id = 'fb000000-0000-4000-8000-000000000005'
      and qualified_at = v_beta_qualified_at
  ) then
    raise exception 'Returning user did not relink the original beta qualification';
  end if;

  select * into v_metrics
  from public.novelight_admin_beta_participation_metrics();

  if v_metrics.latest_founding_number < 101 then
    raise exception 'ADMIN latest Founding number does not include numbers above 100';
  end if;

  if v_metrics.linked_preregistrations <> 1
     or v_metrics.founding_badge_eligible <> 1
     or v_metrics.beta_participants <> 3
     or v_metrics.beta_badge_eligible <> 3 then
    raise exception 'ADMIN qualification counts are inconsistent: %', row_to_json(v_metrics);
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'beta_participants'
      and column_name = 'founding_number'
  ) then
    raise exception 'Beta participant qualification must not have an ordinal number';
  end if;

  if not exists (
    select 1
    from public.beta_author_founding_qualifications
    where preregistration_id = v_prereg_internal
  ) then
    raise exception 'Internal preregistration lost its historical number ledger';
  end if;
end
$test$;

rollback;

select 'PASS: preregistration-order Founding and beta participant qualifications' as result;
