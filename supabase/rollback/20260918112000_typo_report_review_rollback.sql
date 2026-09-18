-- Guarded rollback for 20260918112000_typo_report_review.sql
--
-- Refuse destructive rollback after authors/readers have created any settings
-- or typo-report records. Once used, remediation must preserve those records.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260918112000-typo-report-review:rollback'));

do $$
begin
  if to_regclass('public.episode_typo_reports') is not null
     and exists (select 1 from public.episode_typo_reports limit 1) then
    raise exception 'ROLLBACK REFUSED: typo report records exist';
  end if;

  if to_regclass('public.novel_typo_report_settings') is not null
     and exists (select 1 from public.novel_typo_report_settings limit 1) then
    raise exception 'ROLLBACK REFUSED: author typo reception settings exist';
  end if;
end
$$;

drop function if exists public.novelight_reject_typo_report(uuid);
drop function if exists public.novelight_apply_typo_report(uuid);
drop function if exists public.novelight_author_typo_reports(bigint, text);
drop function if exists public.novelight_submit_typo_report(bigint, text, text);
drop function if exists public.novelight_set_novel_typo_reports_enabled(bigint, boolean);
drop function if exists public.novelight_author_typo_report_settings(bigint);
drop function if exists public.novelight_typo_report_state(bigint);

drop table if exists public.episode_typo_reports;
drop table if exists public.novel_typo_report_settings;

commit;
