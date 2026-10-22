-- Approved DECEMBER calendar amendment, no history or contest identifier rewriting.
-- Precondition: original registration live, no contest reads, snapshots or awards.
begin;
select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('novelight:20261022:starfestival:reschedule'));
do $starfestival_reschedule$
declare
  v_contest public.novelight_contests%rowtype;
  v_updated integer;
begin
  select * into strict v_contest from public.novelight_contests
   where contest_key='novelight-november-2026' for update;
  if v_contest.status <> 'registration'
     or v_contest.public_visible is not true
     or v_contest.entry_deadline_at <> '2026-10-31 14:59:59.999999+00'::timestamptz
     or v_contest.starts_at <> '2026-10-31 15:00:00+00'::timestamptz
     or v_contest.ends_at <> '2026-11-30 15:00:00+00'::timestamptz
     or v_contest.terms_version <> 'november-2026-v1'
     or v_contest.terms_url <> 'https://novelight.jp/contest-terms'
     or pg_catalog.clock_timestamp() >= '2026-11-30 14:59:59.999999+00'::timestamptz then
    raise exception 'STARFESTIVAL_RESCHEDULE_BLOCKED: unexpected original contest state';
  end if;
  if exists (select 1 from public.novelight_contest_read_events where contest_id=v_contest.id)
     or exists (select 1 from public.novelight_contest_rank_snapshots where contest_id=v_contest.id)
     or exists (select 1 from public.novelight_contest_awards where contest_id=v_contest.id) then
    raise exception 'STARFESTIVAL_RESCHEDULE_BLOCKED: contest has rankings, reads, or awards';
  end if;
  update public.novelight_contests set
    title='第1回 星灯祭',
    entry_deadline_at='2026-11-30 14:59:59.999999+00'::timestamptz,
    starts_at='2026-11-30 15:00:00+00'::timestamptz,
    ends_at='2026-12-31 15:00:00+00'::timestamptz,
    terms_version='december-2026-v2',
    updated_at=pg_catalog.clock_timestamp()
  where id=v_contest.id and status='registration';
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'STARFESTIVAL_RESCHEDULE_BLOCKED: update mismatch';
  end if;
  insert into public.novelight_contest_review_audit
    (contest_id,action,reason_code,evidence_summary)
  values (v_contest.id,'schedule_extended','owner_calendar_decision',
    pg_catalog.jsonb_build_object(
      'former_deadline','2026-10-31T23:59:59+09:00',
      'new_deadline','2026-11-30T23:59:59+09:00',
      'new_start','2026-12-01T00:00:00+09:00',
      'new_end_exclusive','2027-01-01T00:00:00+09:00',
      'terms_version','december-2026-v2'));
end;
$starfestival_reschedule$;

create or replace function public.novelight_contest_rank_slot_at(p_slot integer)
returns timestamptz
language sql immutable
set search_path = ''
as $slot$
select case p_slot
  when 1 then '2026-12-07 03:00:00+00'::timestamptz
  when 2 then '2026-12-15 03:00:00+00'::timestamptz
  when 3 then '2026-12-22 03:00:00+00'::timestamptz
  else null::timestamptz
end;
$slot$;

-- The existing RPC privileges remain unchanged on CREATE OR REPLACE.
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
     or v_now < '2026-12-07 03:00:00+00'::timestamptz
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

-- Existing authors retain their entry; provide consent version for v2 re-acceptance.
create or replace function public.novelight_contest_entry_context(
  p_contest_key text default 'novelight-november-2026'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_contest public.novelight_contests%rowtype;
  v_entry public.novelight_contest_entries%rowtype;
  v_works jsonb := '[]'::jsonb;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if v_uid is null then
    raise exception using errcode = '42501',
      message = 'Authentication required';
  end if;

  select * into v_contest
    from public.novelight_contests
   where contest_key = p_contest_key;

  if not found then
    return pg_catalog.jsonb_build_object(
      'ok', false, 'reason', 'contest_unavailable'
    );
  end if;

  if v_contest.public_visible is not true then
    return pg_catalog.jsonb_build_object(
      'ok', false, 'reason', 'contest_unavailable'
    );
  end if;

  select * into v_entry
    from public.novelight_contest_entries
   where contest_id = v_contest.id
     and author_id = v_uid;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', w.id,
        'title', w.title,
        'status', w.status,
        'published_episodes', w.published_episodes,
        'eligible',
          (w.status = 'published'
           and w.published_episodes >= v_contest.minimum_published_episodes
           and w.content_rating in ('general','sensitive_15')
           and w.ai_usage in ('human','ai_assisted'))
      )
      order by w.created_at desc, w.id desc
    ),
    '[]'::jsonb
  ) into v_works
  from (
    select
      n.id, n.title, n.status, n.content_rating, n.ai_usage, n.created_at,
      (select pg_catalog.count(*)::integer
         from public.episodes ep
        where ep.novel_id = n.id
          and ep.status = 'published') as published_episodes
    from public.novels n
    where n.user_id = v_uid
  ) w;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'contest_key', v_contest.contest_key,
    'contest_status', v_contest.status,
    'minimum_published_episodes', v_contest.minimum_published_episodes,
    'terms_version', v_contest.terms_version,
    'terms_url', v_contest.terms_url,
    'entry_deadline_at', v_contest.entry_deadline_at,
    'starts_at', v_contest.starts_at,
    'accepting_entries',
      (v_contest.public_visible is true
       and v_contest.status = 'registration'
       and v_contest.terms_version <> ''
       and v_contest.terms_url <> ''
       and v_now <= v_contest.entry_deadline_at
       and v_now < v_contest.starts_at),
    'entry', case
      when v_entry.id is null then null
      else pg_catalog.jsonb_build_object(
        'novel_id', v_entry.novel_id,
        'novel_title', v_entry.novel_title_snapshot,
        'status', v_entry.status,
        'entered_at', v_entry.entered_at,
        'terms_accepted_version', v_entry.terms_accepted_version
      )
    end,
    'works', v_works
  );
end
$$;

commit;
