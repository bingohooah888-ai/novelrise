-- Approved DECEMBER calendar amendment, no history or contest identifier rewriting.
-- Precondition: original live registration OR unopened fresh draft; no reads, rankings or awards.
begin;
select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('novelight:20261022:starfestival:reschedule'));
do $starfestival_reschedule$
declare
  v_contest public.novelight_contests%rowtype;
  v_updated integer;
begin
  select * into strict v_contest from public.novelight_contests
   where contest_key='novelight-november-2026' for update;
  -- Production is already accepting entries; fresh CI/installation is draft.
  -- Both must preserve their status and visibility while shifting the dates.
  if v_contest.entry_deadline_at <> '2026-10-31 14:59:59.999999+00'::timestamptz
     or v_contest.starts_at <> '2026-10-31 15:00:00+00'::timestamptz
     or v_contest.ends_at <> '2026-11-30 15:00:00+00'::timestamptz
     or not (
       (v_contest.status = 'registration'
        and v_contest.public_visible is true
        and v_contest.terms_version = 'november-2026-v1'
        and v_contest.terms_url = 'https://novelight.jp/contest-terms')
       or
       (v_contest.status = 'draft'
        and v_contest.public_visible is false
        and v_contest.terms_version = ''
        and v_contest.terms_url = '')
     )
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
    terms_version=case when v_contest.status='registration'
      then 'december-2026-v2' else v_contest.terms_version end,
    updated_at=pg_catalog.clock_timestamp()
  where id=v_contest.id and status in ('draft','registration');
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

-- Same-work terms re-acceptance updates ONLY consent metadata, not entry history.
create or replace function public.novelight_contest_entry_action_v2(
  p_action text,
  p_novel_id bigint default null,
  p_contest_key text default 'novelight-november-2026',
  p_terms_version text default null
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
  v_work public.novels%rowtype;
  v_episode_count integer := 0;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if v_uid is null then
    raise exception using errcode = '42501',
      message = 'Authentication required';
  end if;

  if p_action is null or p_action not in ('enter', 'withdraw') then
    return pg_catalog.jsonb_build_object(
      'ok', false, 'reason', 'invalid_action'
    );
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

  if v_contest.public_visible is not true
     or v_contest.status <> 'registration'
     or v_now > v_contest.entry_deadline_at
     or v_now >= v_contest.starts_at then
    return pg_catalog.jsonb_build_object(
      'ok', false, 'reason', 'registration_closed'
    );
  end if;

  -- Serialize all requests from this author to this contest, including
  -- simultaneous tabs, withdrawal, replacement and first-time enrollment.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(v_uid::text),
    pg_catalog.hashtext(v_contest.id::text)
  );

  -- Recheck with fresh server time AFTER possible lock wait. Keep the
  -- contest status stable throughout this transaction.
  select * into v_contest
    from public.novelight_contests
   where id = v_contest.id
   for share;
  v_now := pg_catalog.clock_timestamp();
  if v_contest.public_visible is not true
     or v_contest.status <> 'registration'
     or v_now > v_contest.entry_deadline_at
     or v_now >= v_contest.starts_at then
    return pg_catalog.jsonb_build_object(
      'ok', false, 'reason', 'registration_closed'
    );
  end if;

  -- Only accept author-submitted evidence for the CURRENT official
  -- version, after waiting for the serialization lock. Withdrawal never
  -- requires consenting again.
  if p_action = 'enter' and (
       v_contest.terms_version = ''
       or v_contest.terms_url = ''
       or p_terms_version is distinct from v_contest.terms_version
     ) then
    return pg_catalog.jsonb_build_object(
      'ok', false, 'reason', 'terms_consent_required'
    );
  end if;

  select * into v_entry
    from public.novelight_contest_entries
   where contest_id = v_contest.id
     and author_id = v_uid
   for update;

  if p_action = 'withdraw' then
    if v_entry.id is null or v_entry.status = 'withdrawn' then
      return pg_catalog.jsonb_build_object(
        'ok', true, 'state', 'not_entered'
      );
    end if;
    if v_entry.status = 'disqualified' then
      return pg_catalog.jsonb_build_object(
        'ok', false, 'reason', 'entry_locked'
      );
    end if;
    update public.novelight_contest_entries
       set status = 'withdrawn',
           updated_at = v_now
     where id = v_entry.id;
    return pg_catalog.jsonb_build_object(
      'ok', true, 'state', 'withdrawn'
    );
  end if;

  if p_novel_id is null or p_novel_id <= 0 then
    return pg_catalog.jsonb_build_object(
      'ok', false, 'reason', 'invalid_work'
    );
  end if;

  select * into v_work
    from public.novels
   where id = p_novel_id
     and user_id = v_uid
     and status = 'published';

  if not found then
    return pg_catalog.jsonb_build_object(
      'ok', false, 'reason', 'not_owned_published_work'
    );
  end if;

  -- The competition admits only general / R15 human or AI-assisted works.
  -- This server-side gate is independent of the public catalog zone filter
  -- and executes before the idempotent or replacement entry write.
  if v_work.content_rating is null
     or v_work.content_rating not in ('general','sensitive_15')
     or v_work.ai_usage is null
     or v_work.ai_usage not in ('human','ai_assisted') then
    return pg_catalog.jsonb_build_object(
      'ok', false, 'reason', 'ineligible_work_category'
    );
  end if;

  select pg_catalog.count(*)::integer into v_episode_count
    from public.episodes
   where novel_id = v_work.id
     and status = 'published';

  if v_episode_count < v_contest.minimum_published_episodes then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'reason', 'insufficient_published_episodes',
      'published_episodes', v_episode_count,
      'required_episodes', v_contest.minimum_published_episodes
    );
  end if;

  if v_entry.id is not null then
    if v_entry.status = 'disqualified' then
      return pg_catalog.jsonb_build_object(
        'ok', false, 'reason', 'entry_locked'
      );
    end if;
    -- Amended calendar consent must not rewrite the original entry timestamp,
    -- submission statistics, or the identity of the entered work.
    if v_entry.status = 'entered'
       and v_entry.novel_id = v_work.id
       and v_entry.terms_accepted_version is distinct from v_contest.terms_version then
      update public.novelight_contest_entries
         set terms_accepted_version = v_contest.terms_version,
             terms_accepted_at = v_now,
             updated_at = v_now
       where id = v_entry.id;
      -- Keep an immutable record of the original consent before replacement.
      insert into public.novelight_contest_review_audit
        (contest_id, entry_id, actor_user_id, action, reason_code,
         evidence_summary)
      values (
        v_contest.id, v_entry.id, v_uid, 'terms_reaccepted',
        'december_calendar_amendment',
        pg_catalog.jsonb_build_object(
          'previous_terms_version', v_entry.terms_accepted_version,
          'previous_accepted_at', v_entry.terms_accepted_at,
          'new_terms_version', v_contest.terms_version,
          'new_accepted_at', v_now
        )
      );
      return pg_catalog.jsonb_build_object(
        'ok', true, 'state', 'terms_updated',
        'novel_id', v_work.id
      );
    end if;

    if v_entry.status = 'entered' and v_entry.novel_id = v_work.id
       and v_entry.terms_accepted_version = v_contest.terms_version then
      return pg_catalog.jsonb_build_object(
        'ok', true, 'state', 'already_entered',
        'novel_id', v_work.id
      );
    end if;

    -- One-author/one-work means only ONE active entry; before the deadline
    -- the author may replace or re-enter without creating another row.
    update public.novelight_contest_entries
       set novel_id = v_work.id,
           novel_title_snapshot = v_work.title,
           status = 'entered',
           published_episodes_at_entry = v_episode_count,
           published_episodes_at_close = null,
           entered_at = v_now,
           eligibility_checked_at = v_now,
           terms_accepted_version = v_contest.terms_version,
           terms_accepted_at = v_now,
           reason_code = null,
           updated_at = v_now
     where id = v_entry.id;
  else
    insert into public.novelight_contest_entries (
      contest_id, author_id, novel_id, novel_title_snapshot,
      published_episodes_at_entry, eligibility_checked_at, entered_at,
      terms_accepted_version, terms_accepted_at
    ) values (
      v_contest.id, v_uid, v_work.id, v_work.title,
      v_episode_count, v_now, v_now,
      v_contest.terms_version, v_now
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'ok', true, 'state', 'entered',
    'novel_id', v_work.id,
    'published_episodes', v_episode_count
  );
end
$$;

commit;
