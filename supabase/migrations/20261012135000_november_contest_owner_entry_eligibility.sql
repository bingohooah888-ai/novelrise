-- November 2026 contest stage 05: owner-approved entry eligibility only.
-- This does not activate registration, change general discovery, or alter
-- current contest records. The dedicated submission RPC must enforce the
-- general/R15 + human/AI-assisted category restrictions at the server.
begin;
select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtext('novelight:contest:owner-eligibility:20261012135000')
);

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
        'entered_at', v_entry.entered_at
      )
    end,
    'works', v_works
  );
end
$$;

revoke all on function public.novelight_contest_entry_context(text)
  from public, anon, authenticated;
grant execute on function public.novelight_contest_entry_context(text)
  to authenticated;

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

revoke all on function
  public.novelight_contest_entry_action_v2(text,bigint,text,text)
  from public, anon, authenticated;
grant execute on function
  public.novelight_contest_entry_action_v2(text,bigint,text,text)
  to authenticated;

comment on function
  public.novelight_contest_entry_action_v2(text,bigint,text,text)
is 'Only owner-published, 10+ chapter, general/R15 human-or-assisted work with current terms consent may be entered';

commit;
