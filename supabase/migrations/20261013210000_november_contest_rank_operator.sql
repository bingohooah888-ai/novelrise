-- Stage 08 Part B: human-reviewed, snapshot-pinned ranking release.
-- No scheduled job, activation flag, opening or automatic publication here.
begin;
select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtext('novelight:20261013210000:ranking-operator')
);

create or replace function public.novelight_contest_rank_release_preview(
  p_contest_id uuid, p_slot integer
)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $preview$
declare
  v_contest public.novelight_contests%rowtype;
  v_snapshot public.novelight_contest_rank_snapshots%rowtype;
  v_scheduled timestamptz;
  v_rows jsonb := '[]'::jsonb;
  v_fingerprint text;
begin
  v_scheduled := public.novelight_contest_rank_slot_at(p_slot);
  if p_contest_id is null or v_scheduled is null then
    return pg_catalog.jsonb_build_object('ok',false,'reason','invalid_slot');
  end if;
  select * into v_contest from public.novelight_contests
    where id=p_contest_id and contest_key='novelight-november-2026';
  if v_contest.id is null then
    return pg_catalog.jsonb_build_object('ok',false,'reason','contest_not_found');
  end if;
  select * into v_snapshot from public.novelight_contest_rank_snapshots
    where contest_id=p_contest_id and scheduled_publish_at=v_scheduled;
  if v_snapshot.id is null then
    return pg_catalog.jsonb_build_object(
      'ok',true,'available',false,'slot',p_slot,
      'scheduled_publish_at',v_scheduled,'rows',v_rows
    );
  end if;
  select coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'entry_id',r.entry_id,'rank',r.ordinal_rank,
      'points',r.points,'qualifying_readers',r.qualifying_readers
    ) order by r.ordinal_rank,r.entry_id
  ),'[]'::jsonb),
  pg_catalog.md5(coalesce(pg_catalog.string_agg(
    r.entry_id::text || ':' || r.ordinal_rank::text || ':' ||
    r.points::text || ':' || r.qualifying_readers::text,
    ',' order by r.ordinal_rank,r.entry_id
  ),'')) into v_rows,v_fingerprint
  from public.novelight_contest_rank_rows r
  where r.snapshot_id=v_snapshot.id;
  return pg_catalog.jsonb_build_object(
    'ok',true,'available',true,'slot',p_slot,
    'snapshot_id',v_snapshot.id,'status',v_snapshot.status,
    'cutoff_at',v_snapshot.cutoff_at,
    'created_at',v_snapshot.created_at,
    'scheduled_publish_at',v_scheduled,
    'actual_published_at',v_snapshot.actual_published_at,
    'checksum',v_fingerprint,'rows',v_rows,
    'provisional_only',true
  );
end
$preview$;

revoke all on function
  public.novelight_contest_rank_release_preview(uuid,integer)
  from public,anon,authenticated;
grant execute on function
  public.novelight_contest_rank_release_preview(uuid,integer)
  to service_role;

create or replace function public.novelight_contest_admin_rank_action(
  p_contest_id uuid,
  p_slot integer,
  p_actor_user_id uuid,
  p_action text,
  p_expected_snapshot_id uuid,
  p_expected_checksum text,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $admin_action$
declare
  v_contest public.novelight_contests%rowtype;
  v_scheduled timestamptz;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_snapshot public.novelight_contest_rank_snapshots%rowtype;
  v_preview jsonb;
  v_result jsonb;
begin
  v_scheduled := public.novelight_contest_rank_slot_at(p_slot);
  if p_contest_id is null or v_scheduled is null
     or p_actor_user_id is null
     or p_action is null or p_action not in ('prepare','publish')
     or p_note is null
     or pg_catalog.char_length(pg_catalog.btrim(p_note)) < 20
     or pg_catalog.char_length(p_note) > 500 then
    return pg_catalog.jsonb_build_object('ok',false,'reason','invalid_request');
  end if;
  if p_action = 'publish' and
    (p_expected_snapshot_id is null
     or p_expected_checksum is null
     or p_expected_checksum !~ '^[0-9a-f]{32}$') then
    return pg_catalog.jsonb_build_object('ok',false,'reason','missing_snapshot_proof');
  end if;
  select * into v_contest from public.novelight_contests
   where id=p_contest_id and contest_key='novelight-november-2026';
  if v_contest.id is null or v_contest.status <> 'active'
     or v_contest.public_visible is not true then
    return pg_catalog.jsonb_build_object('ok',false,'reason','contest_inactive');
  end if;
  if v_now < v_scheduled or v_now >= v_contest.ends_at then
    return pg_catalog.jsonb_build_object(
      'ok',false,'reason','outside_release_window'
    );
  end if;
  -- Same advisory key as Stage 08 prepare; pin snapshot version and rows.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('novelight:2026:rank-slot:' || p_slot::text)
  );
  if p_action = 'prepare' then
    select public.novelight_contest_prepare_rank_snapshot(
      p_contest_id,p_slot
    ) into v_result;
    if v_result->>'ok' <> 'true' then
      return v_result;
    end if;
    select public.novelight_contest_rank_release_preview(
      p_contest_id,p_slot
    ) into v_preview;
  else
    select * into v_snapshot from public.novelight_contest_rank_snapshots
     where contest_id=p_contest_id and scheduled_publish_at=v_scheduled
     for update;
    if v_snapshot.id is null or v_snapshot.id <> p_expected_snapshot_id
       or v_snapshot.status <> 'draft'
       or v_snapshot.created_at < v_scheduled then
      return pg_catalog.jsonb_build_object(
        'ok',false,'reason','snapshot_not_ready'
      );
    end if;
    select public.novelight_contest_rank_release_preview(
      p_contest_id,p_slot
    ) into v_preview;
    if v_preview->>'checksum' <> p_expected_checksum
       or (v_preview->>'snapshot_id')::uuid <> p_expected_snapshot_id then
      return pg_catalog.jsonb_build_object(
        'ok',false,'reason','stale_preview'
      );
    end if;
    select public.novelight_contest_publish_rank_snapshot(
      p_contest_id,p_slot
    ) into v_result;
    if v_result->>'ok' <> 'true' then
      return v_result;
    end if;
  end if;

  insert into public.novelight_contest_review_audit (
    contest_id,actor_user_id,action,reason_code,evidence_summary
  ) values (
    p_contest_id,p_actor_user_id,'operator_rank_' || p_action,
    'manual_release',
    pg_catalog.jsonb_build_object(
      'slot',p_slot,
      'snapshot_id',v_preview->>'snapshot_id',
      'checksum',v_preview->>'checksum',
      'scheduled_publish_at',v_scheduled,
      'operator_note',pg_catalog.btrim(p_note),
      'provisional_only',true
    )
  );

  return pg_catalog.jsonb_build_object(
    'ok',true,'action',p_action,
    'snapshot_id',v_preview->>'snapshot_id',
    'checksum',v_preview->>'checksum',
    'published',p_action='publish',
    'provisional_only',true
  );
end
$admin_action$;

revoke all on function public.novelight_contest_admin_rank_action(
  uuid,integer,uuid,text,uuid,text,text
) from public,anon,authenticated;
grant execute on function public.novelight_contest_admin_rank_action(
  uuid,integer,uuid,text,uuid,text,text
) to service_role;

-- This RPC only PREPARES unpublished rows, never publishes them.
-- It stays dormant without separately authorized Cron wiring + feature flag.
create or replace function public.novelight_contest_auto_prepare_rank_slot(
  p_contest_id uuid,p_slot integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $auto$
declare
  v_slot timestamptz;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_result jsonb;
  v_contest public.novelight_contests%rowtype;
begin
  v_slot := public.novelight_contest_rank_slot_at(p_slot);
  if p_contest_id is null or v_slot is null then
    return pg_catalog.jsonb_build_object('ok',false,'reason','invalid_slot');
  end if;
  if v_now < v_slot or v_now >= v_slot + interval '15 minutes' then
    return pg_catalog.jsonb_build_object('ok',false,'reason','outside_prepare_window');
  end if;
  select * into v_contest from public.novelight_contests
   where id=p_contest_id and contest_key='novelight-november-2026';
  if v_contest.id is null or v_contest.status <> 'active'
     or v_contest.public_visible is not true then
    return pg_catalog.jsonb_build_object('ok',false,'reason','contest_inactive');
  end if;
  select public.novelight_contest_prepare_rank_snapshot(p_contest_id,p_slot)
    into v_result;
  if v_result->>'ok' <> 'true' then return v_result; end if;
  insert into public.novelight_contest_review_audit (
    contest_id,action,reason_code,evidence_summary
  ) values (
    p_contest_id,'automatic_rank_prepare','scheduled_private_snapshot',
    pg_catalog.jsonb_build_object(
      'slot',p_slot,'snapshot_id',v_result->>'snapshot_id',
      'automated',true,'published',false
    )
  );
  return v_result;
end
$auto$;
revoke all on function
  public.novelight_contest_auto_prepare_rank_slot(uuid,integer)
  from public,anon,authenticated;
grant execute on function
  public.novelight_contest_auto_prepare_rank_slot(uuid,integer)
  to service_role;

commit;
