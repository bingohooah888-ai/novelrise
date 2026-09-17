\set ON_ERROR_STOP on

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260918080000-typo-report-workflow'));

do $$
begin
  if to_regclass('public.episode_typo_reports') is null then
    raise exception 'public.episode_typo_reports is missing; rollback scope is ambiguous';
  end if;

  if exists (select 1 from public.episode_typo_reports) then
    raise exception 'Refusing lossy rollback while typo reports exist';
  end if;

  if exists (
    select 1
      from public.novels
     where typo_reports_enabled is false
  ) then
    raise exception 'Refusing lossy rollback while an author has disabled typo reports';
  end if;
end
$$;

drop trigger if exists episode_typo_reports_after_content_update on public.episodes;
drop function if exists public.novelight_stale_episode_typo_reports();
drop function if exists public.novelight_reject_episode_typo_report(uuid);
drop function if exists public.novelight_apply_episode_typo_report(uuid);
drop function if exists public.novelight_list_episode_typo_reports(bigint);
drop function if exists public.novelight_submit_episode_typo_report(bigint, integer, text, text);

drop table public.episode_typo_reports;

alter table public.novels
  drop column typo_reports_enabled;

commit;
