-- NOVELIGHT trusted public impression receipts postcheck.
\set ON_ERROR_STOP on

do $$
declare
  v_signature text;
  v_expected_secdef boolean;
  v_oid oid;
  v_secdef boolean;
  v_config text[];
  v_definition text;
  v_required text;
begin
  if to_regnamespace('private') is null then
    raise exception 'private schema was not created';
  end if;

  if has_schema_privilege('public', 'private', 'USAGE')
     or not has_schema_privilege('anon', 'private', 'USAGE')
     or not has_schema_privilege('authenticated', 'private', 'USAGE') then
    raise exception 'private schema privileges do not match the trusted wrapper contract';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'novel_allocation_receipts'
      and column_name = 'viewer_key'
      and data_type = 'text'
  ) then
    raise exception 'novel_allocation_receipts.viewer_key was not created as text';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'novel_allocation_receipts'
      and column_name = 'viewer_id'
      and data_type = 'uuid'
      and is_nullable = 'YES'
  ) then
    raise exception 'novel_allocation_receipts.viewer_id was not made nullable';
  end if;

  if exists (
    select 1
    from public.novel_allocation_receipts
    where not (
      (
        viewer_id is not null
        and (viewer_key is null or viewer_key = 'user:' || viewer_id::text)
      )
      or (
        viewer_id is null
        and viewer_key like 'visitor:%'
        and length(viewer_key) between 16 and 136
      )
    )
  ) then
    raise exception 'novel_allocation_receipts contains invalid viewer ownership state';
  end if;

  select pg_get_constraintdef(oid)
    into v_definition
  from pg_constraint
  where conrelid = 'public.novel_allocation_receipts'::regclass
    and conname = 'novel_allocation_receipts_viewer_check'
    and convalidated;

  if v_definition is null
     or position('visitor:%' in v_definition) = 0
     or position('viewer_key' in v_definition) = 0 then
    raise exception 'viewer ownership constraint is missing or incomplete';
  end if;

  select pg_get_constraintdef(oid)
    into v_definition
  from pg_constraint
  where conrelid = 'public.novel_allocation_receipts'::regclass
    and conname = 'novel_allocation_receipts_surface_check'
    and convalidated;

  if v_definition is null then
    raise exception 'receipt surface constraint is missing or unvalidated';
  end if;

  foreach v_required in array array[
    'home_discovery', 'home_plan_extra', 'home_premium_slot', 'search_recommended',
    'home_new', 'home_seed', 'home_rank_unseen', 'home_rank_gathering',
    'search_new', 'search_seed'
  ] loop
    if position(v_required in v_definition) = 0 then
      raise exception 'receipt surface constraint is missing %', v_required;
    end if;
  end loop;

  select pg_get_constraintdef(oid)
    into v_definition
  from pg_constraint
  where conrelid = 'public.novel_allocation_receipts'::regclass
    and conname = 'novel_allocation_receipts_allocation_reason_check'
    and convalidated;

  if v_definition is null then
    raise exception 'receipt allocation reason constraint is missing or unvalidated';
  end if;

  foreach v_required in array array[
    'balanced', 'initial_exposure', 'plan_extra', 'premium_extra',
    'new_arrival', 'light_seed_discovery', 'rank_discovery'
  ] loop
    if position(v_required in v_definition) = 0 then
      raise exception 'receipt allocation reason constraint is missing %', v_required;
    end if;
  end loop;

  select pg_get_constraintdef(oid)
    into v_definition
  from pg_constraint
  where conrelid = 'public.novel_exposure_events'::regclass
    and conname = 'novel_exposure_events_surface_check'
    and convalidated;

  if v_definition is null then
    raise exception 'exposure surface constraint is missing or unvalidated';
  end if;

  foreach v_required in array array[
    'home_discovery', 'home_plan_extra', 'home_premium_slot', 'search_recommended',
    'search_results', 'home_new', 'home_seed', 'home_rank_unseen',
    'home_rank_gathering', 'search_new', 'search_seed'
  ] loop
    if position(v_required in v_definition) = 0 then
      raise exception 'exposure surface constraint is missing %', v_required;
    end if;
  end loop;

  select pg_get_constraintdef(oid)
    into v_definition
  from pg_constraint
  where conrelid = 'public.novel_exposure_events'::regclass
    and conname = 'novel_exposure_events_allocation_reason_check'
    and convalidated;

  if v_definition is null then
    raise exception 'exposure allocation reason constraint is missing or unvalidated';
  end if;

  foreach v_required in array array[
    'balanced', 'initial_exposure', 'plan_extra', 'premium_extra',
    'new_arrival', 'light_seed_discovery', 'rank_discovery'
  ] loop
    if position(v_required in v_definition) = 0 then
      raise exception 'exposure allocation reason constraint is missing %', v_required;
    end if;
  end loop;

  for v_signature, v_expected_secdef in
    select *
    from (values
      ('private.novelight_trusted_discovery_feed_v2_impl(text,integer,text,text,text)', true),
      ('private.novelight_trusted_plan_extra_feed_v2_impl(integer,text[],text)', true),
      ('private.novelight_issue_visible_allocation_receipts_v2_impl(text,text[],text,integer,text)', true),
      ('private.record_trusted_allocation_receipts_v2_impl(uuid[],text)', true),
      ('public.novelight_trusted_discovery_feed_v2(text,integer,text,text,text)', false),
      ('public.novelight_trusted_plan_extra_feed_v2(integer,text[],text)', false),
      ('public.novelight_issue_visible_allocation_receipts_v2(text,text[],text,integer,text)', false),
      ('public.record_trusted_allocation_receipts_v2(uuid[],text)', false)
    ) as expected(signature, secdef)
  loop
    v_oid := to_regprocedure(v_signature);
    if v_oid is null then
      raise exception 'required function is missing: %', v_signature;
    end if;

    select prosecdef, proconfig
      into v_secdef, v_config
    from pg_proc
    where oid = v_oid;

    if v_secdef is distinct from v_expected_secdef then
      raise exception 'security mode mismatch for %', v_signature;
    end if;

    if not coalesce(v_config, '{}'::text[]) @> array['search_path=""']::text[] then
      raise exception 'fixed empty search_path is missing for %', v_signature;
    end if;

    if has_function_privilege('public', v_signature, 'EXECUTE')
       or not has_function_privilege('anon', v_signature, 'EXECUTE')
       or not has_function_privilege('authenticated', v_signature, 'EXECUTE') then
      raise exception 'function privilege mismatch for %', v_signature;
    end if;
  end loop;

  if has_function_privilege('public', 'public.record_novel_impressions(text,text[],text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.record_novel_impressions(text,text[],text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.record_novel_impressions(text,text[],text)', 'EXECUTE')
     or has_function_privilege('public', 'public.record_novel_impressions_v2(text,text[],text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.record_novel_impressions_v2(text,text[],text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.record_novel_impressions_v2(text,text[],text)', 'EXECUTE') then
    raise exception 'generic direct impression writers are exposed';
  end if;

  if has_table_privilege('anon', 'public.novel_allocation_receipts', 'SELECT')
     or has_table_privilege('authenticated', 'public.novel_allocation_receipts', 'SELECT')
     or has_table_privilege('anon', 'public.novel_allocation_receipts', 'INSERT')
     or has_table_privilege('authenticated', 'public.novel_allocation_receipts', 'INSERT')
     or has_table_privilege('anon', 'public.novel_allocation_receipts', 'UPDATE')
     or has_table_privilege('authenticated', 'public.novel_allocation_receipts', 'UPDATE') then
    raise exception 'allocation receipt table is directly exposed';
  end if;
end
$$;

select 'PASS: trusted public impression receipts postcheck' as result;
