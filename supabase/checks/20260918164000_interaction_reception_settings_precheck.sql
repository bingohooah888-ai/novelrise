-- Precheck for 20260918164000_interaction_reception_settings.sql

do $$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.novels') is null
     or to_regclass('public.novel_comments') is null
     or to_regclass('public.novel_typo_report_settings') is null then
    raise exception 'PRECHECK FAIL: required interaction tables are missing';
  end if;

  if to_regprocedure('public.post_novel_comment(text,text)') is null
     or to_regprocedure('public.novelight_author_typo_report_settings(bigint)') is null
     or to_regprocedure('public.novelight_set_novel_typo_reports_enabled(bigint,boolean)') is null then
    raise exception 'PRECHECK FAIL: required interaction RPCs are missing';
  end if;

  if to_regclass('public.author_interaction_defaults') is not null
     or to_regclass('public.novel_comment_reception_settings') is not null
     or to_regclass('public.novel_interaction_settings') is not null then
    raise exception 'PRECHECK FAIL: interaction settings tables already exist';
  end if;

  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'novel_typo_report_settings'
       and column_name = 'inherits_author_default'
  ) then
    raise exception 'PRECHECK FAIL: typo inheritance column already exists';
  end if;

  if to_regprocedure('public.novelight_author_interaction_defaults()') is not null
     or to_regprocedure('public.novelight_set_author_interaction_defaults(boolean,boolean)') is not null
     or to_regprocedure('public.novelight_author_novel_interaction_settings(bigint)') is not null
     or to_regprocedure('public.novelight_set_novel_interaction_settings(bigint,boolean,boolean)') is not null
     or to_regprocedure('public.novelight_novel_comment_reception_state(bigint)') is not null
     or to_regprocedure('public._novelight_enforce_comment_reception()') is not null
     or to_regprocedure('public._novelight_seed_typo_reception_for_novel()') is not null then
    raise exception 'PRECHECK FAIL: interaction settings functions already exist';
  end if;

  if exists (
    select 1
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and not t.tgisinternal
       and t.tgname in (
         'novelight_enforce_comment_reception',
         'novelight_seed_typo_reception_for_novel'
       )
  ) then
    raise exception 'PRECHECK FAIL: interaction settings trigger already exists';
  end if;
end
$$;

select 'PRECHECK PASS: B #11 interaction reception prerequisites are ready' as result;
