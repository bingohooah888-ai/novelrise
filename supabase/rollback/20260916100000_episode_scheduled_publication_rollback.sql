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


-- Publication-embargo rollback compatibility:
-- The newer reader SELECT policy and read RPCs reference scheduled_publish_at.
-- Remove only that reference before dropping the old scheduling column.
-- Retain first-publication embargo and every owner-access exception.
-- The guard keeps this historical rollback usable on earlier schemas too.
do $embargo_rollback$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'episodes'
      and column_name = 'scheduled_publish_at'
  ) and exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'episodes'
      and column_name = 'first_published_at'
  ) then
    if exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = 'episodes'
        and policyname = 'novelrise_episodes_select_published_or_novel_owner'
    ) then
      execute $restore_policy$
        alter policy novelrise_episodes_select_published_or_novel_owner
          on public.episodes
          using (
            (
              status = 'published'
              and (first_published_at is null or first_published_at <= now())
              and exists (
                select 1 from public.novels n
                where n.id = episodes.novel_id
                  and n.status = 'published'
                  and (n.first_published_at is null or n.first_published_at <= now())
              )
            )
            or (
              (select auth.uid()) is not null
              and exists (
                select 1 from public.novels n
                where n.id = episodes.novel_id
                  and n.user_id = (select auth.uid())
              )
            )
          );
      $restore_policy$;
    end if;
    if to_regprocedure('public.novelight_reader_episode_index(text[])') is not null then
      execute $restore_reader$
CREATE OR REPLACE FUNCTION public.novelight_reader_episode_index(p_novel_ids text[])
 RETURNS TABLE(novel_id text, episode_id text, episode_number bigint, episode_title text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if p_novel_ids is null
     or cardinality(p_novel_ids) < 1
     or cardinality(p_novel_ids) > 50
     or cardinality(p_novel_ids) <>
       cardinality(array(select distinct x from unnest(p_novel_ids) as x)) then
    raise exception using errcode = '22023',
      message = 'Reader episode index requires 1 to 50 unique works';
  end if;

  return query
  select
    n.id::text as novel_id,
    e.id::text as episode_id,
    e.episode_number::bigint,
    e.title as episode_title
  from (select unnest(p_novel_ids) as novel_id) requested
  join public.novels n
    on n.id::text = requested.novel_id
   and n.status = 'published'
  join public.episodes e
    on e.novel_id = n.id
   and e.status = 'published'
   and (e.first_published_at is null or e.first_published_at <= now())
  order by n.id::text, e.episode_number, e.id;
end
$function$;
      $restore_reader$;
    end if;
    if to_regprocedure('public.novelight_novel_outline(bigint)') is not null then
      execute $restore_outline$
CREATE OR REPLACE FUNCTION public.novelight_novel_outline(p_novel_id bigint)
 RETURNS TABLE(episode_id bigint, episode_title text, episode_number bigint, episode_status text, chapter_id bigint, chapter_title text, chapter_position bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_owner_id uuid;
  v_novel_status text;
  v_is_owner boolean := false;
begin
  if p_novel_id is null then
    return;
  end if;

  select n.user_id, n.status
    into v_owner_id, v_novel_status
    from public.novels n
   where n.id = p_novel_id;

  if not found then
    return;
  end if;

  v_is_owner := v_user_id is not null and v_user_id = v_owner_id;
  if not v_is_owner and v_novel_status <> 'published' then
    return;
  end if;

  return query
  select
    e.id,
    e.title,
    e.episode_number,
    e.status,
    c.id,
    c.title,
    c.position
  from public.episodes e
  left join public.novel_chapters c
    on c.id = e.chapter_id
   and c.novel_id = e.novel_id
  where e.novel_id = p_novel_id
    and (
      v_is_owner
      or (
        v_novel_status = 'published'
        and e.status = 'published'
        and (e.first_published_at is null or e.first_published_at <= now())
      )
    )
  order by e.episode_number, e.id;
end
$function$;
      $restore_outline$;
    end if;
  end if;
end
$embargo_rollback$;

drop index if exists public.episodes_scheduled_publish_due_idx;
alter table public.episodes drop constraint if exists episodes_scheduled_publish_requires_draft;
alter table public.episodes drop column if exists scheduled_publish_at;

-- pg_cron itself is intentionally left installed. It is a shared platform
-- extension and may be used by unrelated jobs later; only NOVELIGHT's job is removed.

commit;