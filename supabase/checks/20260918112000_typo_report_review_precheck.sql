-- Read-only precheck for 20260918112000_typo_report_review.sql

do $$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.novels') is null
     or to_regclass('public.episodes') is null
     or to_regclass('public.episode_revisions') is null
     or to_regclass('public.user_blocks') is null then
    raise exception 'PRECHECK FAIL: typo report prerequisites are missing';
  end if;

  if to_regclass('public.novel_typo_report_settings') is not null
     or to_regclass('public.episode_typo_reports') is not null then
    raise exception 'PRECHECK FAIL: typo report tables already exist';
  end if;

  if to_regprocedure('public.novelight_typo_report_state(bigint)') is not null
     or to_regprocedure('public.novelight_author_typo_report_settings(bigint)') is not null
     or to_regprocedure('public.novelight_set_novel_typo_reports_enabled(bigint,boolean)') is not null
     or to_regprocedure('public.novelight_submit_typo_report(bigint,text,text)') is not null
     or to_regprocedure('public.novelight_author_typo_reports(bigint,text)') is not null
     or to_regprocedure('public.novelight_apply_typo_report(uuid)') is not null
     or to_regprocedure('public.novelight_reject_typo_report(uuid)') is not null then
    raise exception 'PRECHECK FAIL: typo report functions already exist';
  end if;

  if not exists (
    select 1
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'episodes'
       and t.tgname = 'episode_revision_history_before_update'
       and not t.tgisinternal
  ) then
    raise exception 'PRECHECK FAIL: episode revision trigger is missing';
  end if;

  if pg_get_functiondef('public.novelight_capture_episode_revision()'::regprocedure)
     not like '%typo_apply%' then
    raise exception 'PRECHECK FAIL: revision history does not accept typo_apply';
  end if;
end
$$;

select 'PRECHECK PASS: typo report prerequisites are ready' as result;
