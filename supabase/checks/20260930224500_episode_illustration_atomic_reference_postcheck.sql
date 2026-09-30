-- NOVELIGHT: verification after 20260930224500.
-- Read-only. Fails unless the crash-safe reference trigger and disclosure guard are installed exactly enough for Staging approval.

do $$
declare
  v_guard regprocedure;
  v_bundle regprocedure;
  v_bundle_def text;
  v_trigger_count integer;
begin
  if to_regclass('public.episode_illustrations') is null then
    raise exception 'Required table public.episode_illustrations is missing';
  end if;

  v_guard := to_regprocedure('public.novelight_episode_illustration_reference_guard()');
  if v_guard is null then
    raise exception 'Episode illustration reference guard function is missing';
  end if;

  if not exists (
    select 1
      from pg_catalog.pg_proc p
     where p.oid = v_guard
       and p.prosecdef
  ) then
    raise exception 'Episode illustration reference guard must remain SECURITY DEFINER';
  end if;

  select pg_catalog.count(*)::integer
    into v_trigger_count
    from pg_catalog.pg_trigger t
   where t.tgrelid = 'public.episode_illustrations'::regclass
     and t.tgname = 'episode_illustration_reference_guard'
     and not t.tgisinternal
     and t.tgenabled = 'O'
     and t.tgfoid = v_guard
     and (t.tgtype & 4) = 4
     and (t.tgtype & 1) = 1
     and (t.tgtype & 2) = 0
     and (t.tgtype & 64) = 0;

  if v_trigger_count <> 1 then
    raise exception 'Expected one enabled AFTER INSERT FOR EACH ROW illustration reference guard trigger, found %', v_trigger_count;
  end if;

  v_bundle := to_regprocedure('public.novelight_public_episode_illustration_bundle(bigint)');
  if v_bundle is null then
    raise exception 'Public episode illustration bundle function is missing';
  end if;

  select pg_catalog.pg_get_functiondef(v_bundle)
    into v_bundle_def;

  if pg_catalog.position('v_has_referenced_assets' in v_bundle_def) = 0
     or pg_catalog.position('illustration_ai_usage is true' in v_bundle_def) = 0 then
    raise exception 'Public episode illustration bundle is missing referenced-asset AI disclosure gating';
  end if;
end
$$;

select 'PASS: episode illustration atomic references and disclosure guard are installed' as result;
