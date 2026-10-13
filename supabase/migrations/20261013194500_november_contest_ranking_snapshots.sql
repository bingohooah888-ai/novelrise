-- Stage 08: private, immutable rankings with a separate publication gate.
-- Preparation NEVER publishes, triggers an award, or activates the contest.
-- An operator-approved scheduler is separate and NOT installed by this file.
begin;
select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtext('novelight:20261013194500:rank-snapshots')
);

create or replace function public.novelight_contest_rank_slot_at(p_slot integer)
returns timestamptz
language sql immutable
set search_path = ''
as $slot$
select case p_slot
  when 1 then '2026-11-07 03:00:00+00'::timestamptz
  when 2 then '2026-11-15 03:00:00+00'::timestamptz
  when 3 then '2026-11-22 03:00:00+00'::timestamptz
  else null::timestamptz
end;
$slot$;
revoke all on function public.novelight_contest_rank_slot_at(integer)
  from public,anon,authenticated;
grant execute on function public.novelight_contest_rank_slot_at(integer)
  to service_role;

create or replace function public.novelight_contest_prepare_rank_snapshot(
  p_contest_id uuid, p_slot integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $prepare$
declare
  v_contest public.novelight_contests%rowtype;
  v_snapshot public.novelight_contest_rank_snapshots%rowtype;
  v_scheduled timestamptz;
  v_rows integer;
begin
  v_scheduled := public.novelight_contest_rank_slot_at(p_slot);
  if p_contest_id is null or v_scheduled is null then
    return pg_catalog.jsonb_build_object('ok',false,'reason','invalid_slot');
  end if;
  select * into v_contest from public.novelight_contests
   where id = p_contest_id and contest_key = 'novelight-november-2026';
  if v_contest.id is null or v_contest.status <> 'active'
     or v_contest.public_visible is not true
     or v_scheduled < v_contest.starts_at
     or v_scheduled >= v_contest.ends_at then
    return pg_catalog.jsonb_build_object(
      'ok',false,'reason','contest_inactive'
    );
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('novelight:2026:rank-slot:' || p_slot::text)
  );
  insert into public.novelight_contest_rank_snapshots (
    contest_id,cutoff_at,scheduled_publish_at,status
  ) values (p_contest_id,v_scheduled,v_scheduled,'draft')
  on conflict (contest_id,scheduled_publish_at) do nothing;
  select * into v_snapshot from public.novelight_contest_rank_snapshots
   where contest_id = p_contest_id and scheduled_publish_at = v_scheduled
   for update;
  if v_snapshot.cutoff_at <> v_scheduled then
    return pg_catalog.jsonb_build_object('ok',false,'reason','cutoff_mismatch');
  end if;
  if v_snapshot.status <> 'draft' then
    return pg_catalog.jsonb_build_object(
      'ok',false,'reason','snapshot_locked'
    );
  end if;
  -- An early draft is never publishable. On or after the release slot,
  -- serialize and refresh that private draft with the actual cutoff events
  -- instead of leaving it permanently stale and impossible to publish.
  if v_snapshot.created_at < v_scheduled
     and pg_catalog.clock_timestamp() >= v_scheduled then
    delete from public.novelight_contest_rank_rows
     where snapshot_id = v_snapshot.id;
    update public.novelight_contest_rank_snapshots
       set created_at=pg_catalog.clock_timestamp()
     where id=v_snapshot.id;
  end if;
  if exists (
    select 1 from public.novelight_contest_rank_rows
     where snapshot_id = v_snapshot.id
  ) then
    return pg_catalog.jsonb_build_object(
      'ok',true,'prepared',true,'already_prepared',true,
      'snapshot_id',v_snapshot.id,'provisional_only',true
    );
  end if;

  -- Compute from immutable event evidence at cutoff, not current PV or
  -- client-supplied points. Merged/excluded/review-held readers never score.
  -- General-zone entries only; R18 and AI-generated zones are excluded
  -- before placement, exactly as in the public contest catalog.
  with eligible as materialized (
    select e.id as entry_id,e.contest_id,e.author_id
      from public.novelight_contest_entries e
      join public.novels n on n.id = e.novel_id
     where e.contest_id = p_contest_id and e.status = 'entered'
       and n.status = 'published'
       and n.content_rating in ('general','sensitive_15','mature')
       and n.ai_usage in ('human','ai_assisted')
       and (
         select pg_catalog.count(*) from public.episodes ep
          where ep.novel_id = e.novel_id and ep.status = 'published'
       ) >= v_contest.minimum_published_episodes
  ), per_reader as (
    select ev.entry_id,ev.reader_id,
           pg_catalog.count(distinct ev.episode_id_snapshot)::integer as chapters
      from public.novelight_contest_read_events ev
      join eligible en on en.entry_id = ev.entry_id
      join public.novelight_contest_readers reader
        on reader.id = ev.reader_id and reader.contest_id = p_contest_id
     where ev.contest_id = p_contest_id
       and ev.status in ('provisional','accepted')
       and ev.qualified_at >= v_contest.starts_at
       and ev.qualified_at < v_scheduled
       and reader.review_status in ('provisional','cleared')
       and not (
         reader.kind = 'account' and reader.user_id = en.author_id
       )
     group by ev.entry_id,ev.reader_id
  ), work_points as (
    select entry_id,
           pg_catalog.sum(
             case when chapters >= 10 then 5
                  when chapters >= 5 then 3
                  when chapters >= 3 then 1 else 0 end
           )::bigint as points,
           pg_catalog.count(*) filter (where chapters >= 3)::integer
             as qualifying_readers
      from per_reader
     group by entry_id
  ), ordered as (
    select en.entry_id,
           coalesce(wp.points,0)::bigint as points,
           coalesce(wp.qualifying_readers,0)::integer as qualifying_readers,
           pg_catalog.rank() over (
             order by coalesce(wp.points,0) desc
           )::integer as ordinal_rank,
           pg_catalog.row_number() over (
             order by coalesce(wp.points,0) desc,en.entry_id asc
           ) as position
      from eligible en
      left join work_points wp on wp.entry_id = en.entry_id
  )
  insert into public.novelight_contest_rank_rows (
    snapshot_id,contest_id,entry_id,ordinal_rank,points,qualifying_readers
  )
  select v_snapshot.id,p_contest_id,entry_id,ordinal_rank,points,
         qualifying_readers
    from ordered where position <= 10;
  get diagnostics v_rows = row_count;

  return pg_catalog.jsonb_build_object(
    'ok',true,'prepared',true,'already_prepared',false,
    'snapshot_id',v_snapshot.id,'row_count',v_rows,
    'provisional_only',true
  );
end
$prepare$;

revoke all on function
  public.novelight_contest_prepare_rank_snapshot(uuid,integer)
  from public,anon,authenticated;
grant execute on function
  public.novelight_contest_prepare_rank_snapshot(uuid,integer)
  to service_role;

-- Publishing is intentionally a separate, audited operational decision:
-- a pre-created draft cannot be made public before its exact JST noon slot.
-- Publishing a snapshot prepared BEFORE its slot is forbidden (stale scores).
create or replace function public.novelight_contest_publish_rank_snapshot(
  p_contest_id uuid,p_slot integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $publish$
declare
  v_scheduled timestamptz;
  v_contest public.novelight_contests%rowtype;
  v_snapshot public.novelight_contest_rank_snapshots%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  v_scheduled := public.novelight_contest_rank_slot_at(p_slot);
  if p_contest_id is null or v_scheduled is null then
    return pg_catalog.jsonb_build_object('ok',false,'reason','invalid_slot');
  end if;
  select * into v_contest from public.novelight_contests
   where id = p_contest_id and contest_key = 'novelight-november-2026';
  if v_contest.id is null or v_contest.status <> 'active'
     or v_contest.public_visible is not true then
    return pg_catalog.jsonb_build_object('ok',false,'reason','contest_inactive');
  end if;
  if v_now < v_scheduled or v_now >= v_contest.ends_at then
    return pg_catalog.jsonb_build_object('ok',false,'reason','outside_publish_window');
  end if;
  select * into v_snapshot
    from public.novelight_contest_rank_snapshots
   where contest_id = p_contest_id and scheduled_publish_at = v_scheduled
   for update;
  if v_snapshot.id is null or v_snapshot.status <> 'draft'
     or v_snapshot.cutoff_at <> v_scheduled
     or v_snapshot.created_at < v_scheduled then
    return pg_catalog.jsonb_build_object(
      'ok',false,'reason','snapshot_not_ready'
    );
  end if;
  if not exists (
    select 1 from public.novelight_contest_rank_rows
    where snapshot_id = v_snapshot.id
  ) then
    return pg_catalog.jsonb_build_object(
      'ok',false,'reason','empty_snapshot'
    );
  end if;
  update public.novelight_contest_rank_snapshots
     set status='published',actual_published_at=v_now
   where id=v_snapshot.id;
  return pg_catalog.jsonb_build_object(
    'ok',true,'published',true,'snapshot_id',v_snapshot.id
  );
end
$publish$;
revoke all on function
  public.novelight_contest_publish_rank_snapshot(uuid,integer)
  from public,anon,authenticated;
grant execute on function
  public.novelight_contest_publish_rank_snapshot(uuid,integer)
  to service_role;

-- Public endpoint exposes only ranked public works after a published snapshot.
-- No reader IDs, raw events, fraud markers, cash awards, or operator notes.
create or replace function public.novelight_public_contest_rankings(
  p_include_r15 boolean default true
)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $public_rank$
declare
  v_contest public.novelight_contests%rowtype;
  v_snapshot public.novelight_contest_rank_snapshots%rowtype;
  v_now timestamptz := pg_catalog.now();
  v_rows jsonb := '[]'::jsonb;
begin
  if p_include_r15 is null then
    return pg_catalog.jsonb_build_object('ok',false,'reason','invalid_preference');
  end if;
  select * into v_contest from public.novelight_contests
   where contest_key='novelight-november-2026';
  if v_contest.id is null
     or v_contest.public_visible is not true
     or v_contest.status not in ('active','review')
     or v_now < '2026-11-07 03:00:00+00'::timestamptz
     or v_now >= v_contest.ends_at then
    return pg_catalog.jsonb_build_object(
      'ok',false,'reason','ranking_unavailable'
    );
  end if;
  select * into v_snapshot
    from public.novelight_contest_rank_snapshots
   where contest_id=v_contest.id
     and status='published'
     and scheduled_publish_at <= v_now
     and actual_published_at <= v_now
   order by scheduled_publish_at desc
   limit 1;
  if v_snapshot.id is null then
    return pg_catalog.jsonb_build_object(
      'ok',false,'reason','ranking_not_published'
    );
  end if;

  select coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'rank',row.ordinal_rank,
      'points',row.points,
      'qualifying_readers',row.qualifying_readers,
      'novel_id',en.novel_id,
      'title',n.title,
      'content_rating',n.content_rating
    ) order by row.points desc,row.ordinal_rank asc,row.entry_id asc
  ),'[]'::jsonb) into v_rows
  from public.novelight_contest_rank_rows row
  join public.novelight_contest_entries en
    on en.id=row.entry_id and en.contest_id=v_contest.id
  join public.novels n on n.id=en.novel_id
  where row.snapshot_id=v_snapshot.id
    and en.status='entered'
    and n.status='published'
    and n.content_rating in ('general','sensitive_15','mature')
    and n.ai_usage in ('human','ai_assisted')
    and (p_include_r15 or n.content_rating='general');

  return pg_catalog.jsonb_build_object(
    'ok',true,'provisional_only',true,
    'scheduled_publish_at',v_snapshot.scheduled_publish_at,
    'actual_published_at',v_snapshot.actual_published_at,
    'snapshot_id',v_snapshot.id,'rows',v_rows
  );
end
$public_rank$;
revoke all on function public.novelight_public_contest_rankings(boolean)
  from public,anon,authenticated;
grant execute on function public.novelight_public_contest_rankings(boolean)
  to anon,authenticated;
commit;
