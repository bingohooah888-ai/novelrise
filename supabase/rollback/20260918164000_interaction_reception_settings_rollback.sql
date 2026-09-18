-- Rollback for 20260918164000_interaction_reception_settings.sql
-- Preserve effective typo reception values. Refuse destructive rollback once
-- the new author/comment preference tables contain user-authored data.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260918164000:rollback'));

do $$
begin
  if to_regclass('public.author_interaction_defaults') is not null
     and exists (select 1 from public.author_interaction_defaults limit 1) then
    raise exception 'ROLLBACK REFUSED: author interaction defaults contain user data';
  end if;

  if to_regclass('public.novel_comment_reception_settings') is not null
     and exists (select 1 from public.novel_comment_reception_settings limit 1) then
    raise exception 'ROLLBACK REFUSED: per-work comment reception settings contain user data';
  end if;
end
$$;

drop trigger if exists novelight_enforce_comment_reception on public.novel_comments;
drop trigger if exists novelight_seed_typo_reception_for_novel on public.novels;

drop function if exists public._novelight_enforce_comment_reception();
drop function if exists public._novelight_seed_typo_reception_for_novel();
drop function if exists public.novelight_novel_comment_reception_state(bigint);
drop function if exists public.novelight_set_novel_interaction_settings(bigint, boolean, boolean);
drop function if exists public.novelight_author_novel_interaction_settings(bigint);
drop function if exists public.novelight_set_author_interaction_defaults(boolean, boolean);
drop function if exists public.novelight_author_interaction_defaults();

create or replace function public.novelight_set_novel_typo_reports_enabled(
  p_novel_id bigint,
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if p_enabled is null then
    raise exception using errcode = '22023', message = 'Enabled state is required';
  end if;

  perform 1
    from public.novels n
   where n.id = p_novel_id
     and n.user_id = v_uid
   for update;

  if not found then
    raise exception using errcode = '42501', message = 'Owned novel not found';
  end if;

  insert into public.novel_typo_report_settings (novel_id, enabled, updated_at)
  values (p_novel_id, p_enabled, pg_catalog.now())
  on conflict (novel_id) do update
    set enabled = excluded.enabled,
        updated_at = pg_catalog.now();

  return public.novelight_author_typo_report_settings(p_novel_id);
end
$$;

drop table if exists public.novel_comment_reception_settings;
drop table if exists public.author_interaction_defaults;

alter table public.novel_typo_report_settings
  drop column if exists inherits_author_default;

commit;
