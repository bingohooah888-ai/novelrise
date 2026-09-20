\set ON_ERROR_STOP on

do $postcheck$
declare
  v_allocator bigint;
  v_max bigint;
begin
  if to_regclass('public.beta_author_founding_number_allocator') is null
     or to_regclass('public.beta_author_founding_qualifications') is null
     or to_regclass('public.beta_participants') is null
     or to_regclass('public.beta_participation_qualification_config') is null then
    raise exception 'Founding/beta qualification objects are missing';
  end if;

  if (select count(*) from public.beta_author_founding_qualifications)
     <> (select count(*) from public.beta_author_preregistrations) then
    raise exception 'Every preregistration must have exactly one permanent Founding number';
  end if;

  if exists (
    select 1
    from public.beta_author_preregistrations p
    left join public.beta_author_founding_qualifications q
      on q.preregistration_id = p.id
    where q.preregistration_id is null
       or q.founding_number <= 0
       or q.qualified_at is distinct from p.created_at
  ) then
    raise exception 'Preregistration Founding qualification backfill is incomplete or inconsistent';
  end if;

  if exists (
    select 1
    from public.beta_author_preregistrations earlier
    join public.beta_author_founding_qualifications eq
      on eq.preregistration_id = earlier.id
    join public.beta_author_preregistrations later
      on (later.created_at, later.id) > (earlier.created_at, earlier.id)
    join public.beta_author_founding_qualifications lq
      on lq.preregistration_id = later.id
    where eq.founding_number >= lq.founding_number
  ) then
    raise exception 'Existing preregistration Founding numbers do not preserve establishment order';
  end if;

  select a.last_number
  into v_allocator
  from public.beta_author_founding_number_allocator a
  where a.id = 1;

  select coalesce(max(q.founding_number), 0)
  into v_max
  from public.beta_author_founding_qualifications q;

  if v_allocator is distinct from v_max then
    raise exception 'Founding number allocator does not match the latest issued number';
  end if;
  if exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.founding_authors'::regclass
      and c.contype = 'c'
      and position('100' in pg_get_constraintdef(c.oid)) > 0
  ) then
    raise exception 'Founding Authors still has a 100-person constraint';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'founding_authors'
      and column_name = 'qualifying_novel_id'
      and is_nullable <> 'YES'
  ) then
    raise exception 'Founding Authors still requires a qualifying novel';
  end if;

  if to_regprocedure('public.assign_founding_author()') is not null then
    raise exception 'Legacy publication-order Founding function still exists';
  end if;

  if exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    where c.oid = 'public.novels'::regclass
      and t.tgname = 'novels_assign_founding_author'
      and not t.tgisinternal
  ) then
    raise exception 'Legacy publication-order Founding trigger still exists';
  end if;

  if exists (
    select 1
    from public.founding_authors f
    join public.founding_author_exclusions e
      on e.user_id = f.author_id
  ) then
    raise exception 'Excluded internal account is still Founding badge eligible';
  end if;

  if exists (
    select 1
    from public.founding_authors f
    left join public.beta_author_preregistrations p
      on p.auth_user_id = f.author_id
     and p.status <> 'cancelled'
    left join public.beta_author_founding_qualifications q
      on q.preregistration_id = p.id
    where p.id is null
       or q.founding_number is distinct from f.founding_number
       or q.qualified_at is distinct from f.qualified_at
       or public.novelight_is_internal_participation_account(f.author_id)
  ) then
    raise exception 'Founding badge rows are not derived from valid preregistration qualifications';
  end if;

  if exists (
    select 1
    from public.beta_author_preregistrations p
    join public.beta_author_founding_qualifications q
      on q.preregistration_id = p.id
    join auth.users u
      on u.id = p.auth_user_id
    where p.status <> 'cancelled'
      and not public.novelight_is_internal_participation_account(u.id)
      and not exists (
        select 1
        from public.founding_authors f
        where f.author_id = u.id
          and f.founding_number = q.founding_number
      )
  ) then
    raise exception 'A valid linked preregistration is missing its Founding badge row';
  end if;

  if has_table_privilege('anon', 'public.beta_author_founding_qualifications', 'SELECT')
     or has_table_privilege('authenticated', 'public.beta_author_founding_qualifications', 'SELECT')
     or has_table_privilege('anon', 'public.beta_participants', 'SELECT')
     or has_table_privilege('authenticated', 'public.beta_participants', 'SELECT')
     or has_table_privilege('anon', 'public.beta_participation_qualification_config', 'SELECT')
     or has_table_privilege('authenticated', 'public.beta_participation_qualification_config', 'SELECT') then
    raise exception 'Private participation qualification tables are exposed to client roles';
  end if;

  if has_function_privilege(
       'anon',
       'public.novelight_admin_beta_participation_metrics()',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.novelight_admin_beta_participation_metrics()',
       'EXECUTE'
     ) then
    raise exception 'ADMIN participation metrics RPC is exposed to client roles';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.novelight_admin_beta_participation_metrics()',
    'EXECUTE'
  ) then
    raise exception 'ADMIN participation metrics RPC is unavailable to service_role';
  end if;

  if not exists (
    select 1
    from public.beta_participation_qualification_config c
    where c.id = 1
      and c.starts_at = timestamptz '2026-09-28 00:00:00+09'
      and c.ends_at is null
  ) then
    raise exception 'Beta qualification window does not start at the formal preopen';
  end if;

  if exists (
    select 1
    from public.beta_participants b
    where b.auth_user_id is not null
      and public.novelight_is_internal_participation_account(b.auth_user_id)
  ) then
    raise exception 'Internal/test account leaked into beta participant qualifications';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'beta_author_preregistration_assign_founding'
      and not tgisinternal
  )
  or not exists (
    select 1 from pg_trigger
    where tgname = 'novelight_auth_user_sync_participation'
      and not tgisinternal
  )
  or not exists (
    select 1 from pg_trigger
    where tgname = 'novelight_auth_user_unlink_participation'
      and not tgisinternal
  )
  or not exists (
    select 1 from pg_trigger
    where tgname = 'founding_author_exclusions_sync_participation'
      and not tgisinternal
  ) then
    raise exception 'One or more participation qualification triggers are missing';
  end if;
end
$postcheck$;
