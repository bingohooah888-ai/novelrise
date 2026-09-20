\set ON_ERROR_STOP on

do $precheck$
declare
  v_constraint text;
begin
  if to_regclass('public.beta_author_preregistrations') is null
     or to_regclass('public.founding_authors') is null
     or to_regclass('public.founding_author_exclusions') is null
     or to_regclass('auth.users') is null then
    raise exception 'Founding/beta qualification prerequisites are missing';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'auth'
      and table_name = 'users'
      and column_name = 'email'
  ) then
    raise exception 'auth.users.email is required for safe preregistration linking';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'auth'
      and table_name = 'users'
      and column_name = 'raw_app_meta_data'
  ) then
    raise exception 'auth.users.raw_app_meta_data is required for internal test-account exclusion';
  end if;

  if to_regclass('public.beta_author_founding_number_allocator') is not null
     or to_regclass('public.beta_author_founding_qualifications') is not null
     or to_regclass('public.beta_participants') is not null
     or to_regclass('public.beta_participation_qualification_config') is not null then
    raise exception 'Founding/beta qualification target objects already exist';
  end if;

  if to_regprocedure('public.assign_founding_author()') is null then
    raise exception 'Legacy publication-order Founding function is missing; inspect drift';
  end if;

  if not exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'novels'
      and t.tgname = 'novels_assign_founding_author'
      and not t.tgisinternal
  ) then
    raise exception 'Legacy publication-order Founding trigger is missing; inspect drift';
  end if;

  select pg_get_constraintdef(c.oid)
  into v_constraint
  from pg_constraint c
  where c.conrelid = 'public.founding_authors'::regclass
    and c.conname = 'founding_authors_founding_number_check';

  if v_constraint is null
     or position('100' in v_constraint) = 0 then
    raise exception 'Legacy Founding 1-100 constraint no longer matches expected baseline';
  end if;

  if exists (
    select 1
    from public.founding_authors f
    where f.founding_number < 1 or f.founding_number > 100
  ) then
    raise exception 'Legacy Founding rows already exceed the expected 1-100 contract';
  end if;

  if exists (
    select p.auth_user_id
    from public.beta_author_preregistrations p
    where p.auth_user_id is not null
    group by p.auth_user_id
    having count(*) > 1
  ) then
    raise exception 'Multiple preregistrations are linked to the same Auth user';
  end if;

  if exists (
    select 1
    from public.beta_author_preregistrations p
    left join auth.users u on u.id = p.auth_user_id
    where p.auth_user_id is not null
      and (
        u.id is null
        or lower(btrim(coalesce(u.email, ''))) <> p.email_normalized
      )
  ) then
    raise exception 'Existing preregistration Auth links contain missing or email-mismatched users';
  end if;

  if exists (
    select lower(btrim(coalesce(u.email, '')))
    from auth.users u
    join public.beta_author_preregistrations p
      on p.email_normalized = lower(btrim(coalesce(u.email, '')))
    where btrim(coalesce(u.email, '')) <> ''
    group by lower(btrim(coalesce(u.email, '')))
    having count(*) > 1
  ) then
    raise exception 'Multiple Auth users match the same preregistration email';
  end if;
end
$precheck$;
