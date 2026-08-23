-- NOVELIGHT exposure-to-reading funnel postcheck.
\set ON_ERROR_STOP on

do $$
begin
  if to_regclass('public.novel_exposure_conversions') is null then
    raise exception 'novel_exposure_conversions was not created';
  end if;

  if has_table_privilege('anon', 'public.novel_exposure_conversions', 'SELECT')
     or has_table_privilege('authenticated', 'public.novel_exposure_conversions', 'SELECT')
     or has_table_privilege('anon', 'public.novel_exposure_conversions', 'INSERT')
     or has_table_privilege('authenticated', 'public.novel_exposure_conversions', 'INSERT') then
    raise exception 'raw conversion ledger must not be client-readable or writable';
  end if;

  if to_regprocedure('public.record_novel_exposure_conversion(text,text,text,text)') is null then
    raise exception 'record_novel_exposure_conversion is missing';
  end if;

  if to_regprocedure('public.novelight_author_exposure_funnel(integer)') is null then
    raise exception 'novelight_author_exposure_funnel is missing';
  end if;

  if not has_function_privilege(
    'anon',
    'public.record_novel_exposure_conversion(text,text,text,text)',
    'EXECUTE'
  ) or not has_function_privilege(
    'authenticated',
    'public.record_novel_exposure_conversion(text,text,text,text)',
    'EXECUTE'
  ) then
    raise exception 'reader conversion RPC must be executable by anon and authenticated';
  end if;

  if has_function_privilege(
    'anon',
    'public.novelight_author_exposure_funnel(integer)',
    'EXECUTE'
  ) or not has_function_privilege(
    'authenticated',
    'public.novelight_author_exposure_funnel(integer)',
    'EXECUTE'
  ) then
    raise exception 'author funnel RPC must be authenticated-only';
  end if;
end
$$;

select 'PASS: exposure funnel postcheck' as result;
