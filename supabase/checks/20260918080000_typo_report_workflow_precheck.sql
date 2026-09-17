\set ON_ERROR_STOP on

do $$
begin
  if to_regclass('public.novels') is null
     or to_regclass('public.episodes') is null
     or to_regclass('public.episode_revisions') is null then
    raise exception 'Required novels/episodes/revision-history tables are missing';
  end if;

  if not (select relrowsecurity from pg_class where oid='public.novels'::regclass)
     or not (select relrowsecurity from pg_class where oid='public.episodes'::regclass)
     or not (select relrowsecurity from pg_class where oid='public.episode_revisions'::regclass) then
    raise exception 'Required source tables must keep RLS enabled';
  end if;

  if to_regclass('public.user_blocks') is null then
    raise exception 'user_blocks safety boundary is required';
  end if;

  if to_regclass('public.episode_typo_reports') is not null then
    raise exception 'public.episode_typo_reports already exists';
  end if;

  if exists (
    select 1
      from information_schema.columns
     where table_schema='public'
       and table_name='novels'
       and column_name='typo_reports_enabled'
  ) then
    raise exception 'novels.typo_reports_enabled already exists';
  end if;

  if to_regprocedure('public.novelight_capture_episode_revision()') is null then
    raise exception 'Revision capture function is missing';
  end if;

  if position(
    '''typo_apply''' in pg_get_functiondef(
      'public.novelight_capture_episode_revision()'::regprocedure
    )
  ) = 0 then
    raise exception 'Revision history does not recognize typo_apply';
  end if;

  if to_regprocedure('public.novelight_submit_episode_typo_report(bigint,integer,text,text)') is not null
     or to_regprocedure('public.novelight_list_episode_typo_reports(bigint)') is not null
     or to_regprocedure('public.novelight_apply_episode_typo_report(uuid)') is not null
     or to_regprocedure('public.novelight_reject_episode_typo_report(uuid)') is not null
     or to_regprocedure('public.novelight_stale_episode_typo_reports()') is not null then
    raise exception 'One or more typo-report functions already exist';
  end if;
end
$$;
