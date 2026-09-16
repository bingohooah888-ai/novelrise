\set ON_ERROR_STOP on

begin;

select pg_advisory_xact_lock(hashtext('novelrise:20260916100000:rollback'));

do $$
declare
  v_jobid bigint;
begin
  if to_regclass('public.episodes') is null then
    raise exception 'episodes table is missing';
  end if;

  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'episodes'
       and column_name = 'scheduled_publish_at'
  ) and exists (
    select 1
      from public.episodes
     where scheduled_publish_at is not null
  ) then
    raise exception 'Rollback refused: scheduled episodes still exist. Cancel or publish them before removing scheduled-publication schema.';
  end if;

  if to_regclass('cron.job') is not null then
    execute 'select jobid from cron.job where jobname = $1 order by jobid limit 1'
       into v_jobid
       using 'novelight-publish-scheduled-episodes';
    if v_jobid is not null then
      execute 'select cron.unschedule($1)' using v_jobid;
    end if;
  end if;
end
$$;

revoke all on function public.novelight_schedule_episode_draft(bigint, timestamptz) from public, anon, authenticated;
revoke all on function public.novelight_cancel_episode_schedule(bigint) from public, anon, authenticated;
revoke all on function public.novelight_publish_due_episode_schedules() from public, anon, authenticated, service_role;

drop function if exists public.novelight_schedule_episode_draft(bigint, timestamptz);
drop function if exists public.novelight_cancel_episode_schedule(bigint);
drop function if exists public.novelight_publish_due_episode_schedules();

-- Restore the exact pre-scheduling draft publication contract.
create or replace function public.novelight_publish_episode_draft_atomic(
  p_episode_id bigint
)
returns bigint
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_novel_id bigint;
  v_episode_number bigint;
  v_episode_status text;
  v_novel_status text;
  v_title text;
  v_content text;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select e.novel_id,
         e.episode_number,
         e.status,
         e.title,
         e.content,
         n.status
  into v_novel_id,
       v_episode_number,
       v_episode_status,
       v_title,
       v_content,
       v_novel_status
  from public.episodes e
  join public.novels n on n.id = e.novel_id
  where e.id = p_episode_id
    and e.user_id = v_user_id
    and n.user_id = v_user_id
  for update of e, n;

  if not found then
    raise exception 'Draft episode not found or not owned by current user' using errcode = '42501';
  end if;
  if v_episode_status <> 'draft' then
    raise exception 'Only draft episodes can be published by this RPC' using errcode = '22023';
  end if;
  if v_episode_number is null or v_episode_number < 1 then
    raise exception 'A valid episode number is required before publication' using errcode = '22023';
  end if;
  if char_length(trim(coalesce(v_title, ''))) < 1 or char_length(v_title) > 150 then
    raise exception 'Episode title must contain 1 to 150 characters before publication' using errcode = '22023';
  end if;
  if char_length(trim(coalesce(v_content, ''))) < 1 or char_length(v_content) > 100000 then
    raise exception 'Episode content must contain 1 to 100000 characters before publication' using errcode = '22023';
  end if;
  if v_novel_status <> 'published' and v_episode_number <> 1 then
    raise exception 'The first published episode must be episode 1' using errcode = '22023';
  end if;

  if v_novel_status <> 'published' then
    update public.novels
    set status = 'published'
    where id = v_novel_id
      and user_id = v_user_id;
    if not found then
      raise exception 'Novel could not be published by current user' using errcode = '42501';
    end if;
  end if;

  update public.episodes
  set status = 'published'
  where id = p_episode_id
    and user_id = v_user_id
    and status = 'draft';
  if not found then
    raise exception 'Draft episode publication raced with another update' using errcode = '40001';
  end if;

  return p_episode_id;
end
$$;

revoke all on function public.novelight_publish_episode_draft_atomic(bigint) from public;
revoke all on function public.novelight_publish_episode_draft_atomic(bigint) from anon;
grant execute on function public.novelight_publish_episode_draft_atomic(bigint) to authenticated;

drop index if exists public.episodes_scheduled_publish_due_idx;
alter table public.episodes drop constraint if exists episodes_scheduled_publish_requires_draft;
alter table public.episodes drop column if exists scheduled_publish_at;

-- pg_cron itself is intentionally left installed. It is a shared platform
-- extension and may be used by unrelated jobs later; only NOVELIGHT's job is removed.

commit;