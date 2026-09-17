\set ON_ERROR_STOP on

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260918080000-typo-report-safe-apply'));

do $$
begin
  if to_regclass('public.episode_typo_reports') is null
     or to_regclass('public.author_interaction_defaults') is null
     or to_regclass('public.novel_interaction_settings') is null then
    raise exception 'Typo-report rollback scope is ambiguous because expected tables are missing';
  end if;

  if exists (select 1 from public.episode_typo_reports)
     or exists (select 1 from public.author_interaction_defaults)
     or exists (select 1 from public.novel_interaction_settings) then
    raise exception 'Refusing lossy rollback while typo reports or author preferences exist';
  end if;
end
$$;

drop function if exists public.novelight_resolve_typo_report(uuid, text);
drop function if exists public.novelight_list_author_typo_reports(bigint);
drop function if exists public.novelight_submit_typo_report(bigint, integer, text, text);
drop function if exists public.novelight_typo_report_state(bigint);
drop function if exists public.novelight_set_novel_typo_report_settings(bigint, boolean);
drop function if exists public.novelight_author_novel_typo_report_settings(bigint);
drop function if exists public.novelight_set_author_typo_report_defaults(boolean);
drop function if exists public.novelight_author_typo_report_defaults();

drop table public.episode_typo_reports;
drop table public.novel_interaction_settings;
drop table public.author_interaction_defaults;

commit;
