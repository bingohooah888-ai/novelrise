-- NOVELIGHT: precheck before installing crash-safe episode illustration references.
-- Read-only. Abort when prerequisites are missing or the target migration is partial/already installed.

do $$
declare
  v_bundle regprocedure;
  v_bundle_def text;
begin
  if to_regclass('public.episodes') is null
     or to_regclass('public.novels') is null
     or to_regclass('public.episode_illustrations') is null then
    raise exception 'Episode illustration atomic-reference prerequisites are missing';
  end if;

  v_bundle := to_regprocedure('public.novelight_public_episode_illustration_bundle(bigint)');
  if v_bundle is null then
    raise exception 'Required public episode illustration bundle function is missing';
  end if;

  if to_regprocedure('public.novelight_episode_illustration_reference_guard()') is not null then
    raise exception 'Episode illustration reference guard function already exists or migration is partial';
  end if;

  if exists (
    select 1
      from pg_catalog.pg_trigger t
     where t.tgrelid = 'public.episode_illustrations'::regclass
       and t.tgname = 'episode_illustration_reference_guard'
       and not t.tgisinternal
  ) then
    raise exception 'Episode illustration reference guard trigger already exists or migration is partial';
  end if;

  select pg_catalog.pg_get_functiondef(v_bundle)
    into v_bundle_def;

  if pg_catalog.position('v_has_referenced_assets' in v_bundle_def) > 0 then
    raise exception 'Public episode illustration bundle already contains atomic-reference disclosure logic';
  end if;
end
$$;

select 'PASS: episode illustration atomic-reference baseline is safe for migration' as result;
