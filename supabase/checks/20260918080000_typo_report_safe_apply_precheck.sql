\set ON_ERROR_STOP on

do $$
begin
  if to_regclass('public.novels') is null
     or to_regclass('public.episodes') is null
     or to_regclass('public.episode_revisions') is null then
    raise exception 'Required novels/episodes/episode_revisions tables are missing';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.novels'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.episodes'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.episode_revisions'::regclass) then
    raise exception 'RLS must be enabled on novels, episodes, and episode_revisions';
  end if;

  if not exists (
    select 1
      from pg_trigger
     where tgrelid = 'public.episodes'::regclass
       and tgname = 'episode_revision_history_before_update'
       and not tgisinternal
  ) then
    raise exception 'Episode revision history trigger is missing';
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.episode_revisions'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%typo_apply%'
  ) then
    raise exception 'episode_revisions.change_kind does not support typo_apply';
  end if;

  if to_regclass('public.author_interaction_defaults') is not null
     or to_regclass('public.novel_interaction_settings') is not null
     or to_regclass('public.episode_typo_reports') is not null then
    raise exception 'Typo-report foundation already exists';
  end if;

  if to_regprocedure('public.novelight_author_typo_report_defaults()') is not null
     or to_regprocedure('public.novelight_set_author_typo_report_defaults(boolean)') is not null
     or to_regprocedure('public.novelight_author_novel_typo_report_settings(bigint)') is not null
     or to_regprocedure('public.novelight_set_novel_typo_report_settings(bigint,boolean)') is not null
     or to_regprocedure('public.novelight_typo_report_state(bigint)') is not null
     or to_regprocedure('public.novelight_submit_typo_report(bigint,integer,text,text)') is not null
     or to_regprocedure('public.novelight_list_author_typo_reports(bigint)') is not null
     or to_regprocedure('public.novelight_resolve_typo_report(uuid,text)') is not null then
    raise exception 'Typo-report RPC already exists';
  end if;
end
$$;

select 'PRECHECK PASS: typo-report prerequisites are ready' as result;
