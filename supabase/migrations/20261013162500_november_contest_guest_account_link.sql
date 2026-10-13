-- Stage 06: authenticated account claims a previously signed guest credential.
-- This is provisional, contest-scoped evidence consolidation only, not human
-- uniqueness or stage-07 fraud clearance. Never run without new approval.
begin;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtext('novelight:20261013162500:guest-link')
);

create or replace function public.novelight_contest_link_guest_account(
  p_contest_id uuid,
  p_guest_key_hash text,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $link$
declare
  v_contest public.novelight_contests%rowtype;
  v_guest public.novelight_contest_readers%rowtype;
  v_account public.novelight_contest_readers%rowtype;
  v_entry_id uuid;
  v_inserted integer := 0;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_contest_id is null or p_user_id is null or
     p_guest_key_hash is null or
     p_guest_key_hash !~ '^[0-9a-f]{64}$' then
    return pg_catalog.jsonb_build_object('ok',false,'reason','invalid_request');
  end if;

  select * into v_contest
    from public.novelight_contests
   where id = p_contest_id
     and contest_key = 'novelight-november-2026';
  if v_contest.id is null or v_contest.status <> 'active' or
     v_contest.public_visible is not true or
     v_now < v_contest.starts_at or v_now >= v_contest.ends_at then
    return pg_catalog.jsonb_build_object('ok',false,'reason','contest_inactive');
  end if;

  -- The HTTP boundary has already validated the bearer token and signed
  -- HttpOnly guest cookie. Here we serialize guest ownership before copying.
  select * into v_guest
    from public.novelight_contest_readers
   where contest_id = v_contest.id and kind = 'guest'
     and guest_key_hash = p_guest_key_hash
   for update;
  if v_guest.id is null then
    return pg_catalog.jsonb_build_object(
      'ok',true,'linked',false,'reason','no_guest_evidence',
      'provisional_only',true
    );
  end if;

  if v_guest.review_status = 'merged' then
    if exists (
      select 1 from public.novelight_contest_readers a
       where a.id = v_guest.merged_into_reader_id
         and a.contest_id = v_contest.id and a.kind = 'account'
         and a.user_id = p_user_id
    ) then
      return pg_catalog.jsonb_build_object(
        'ok',true,'linked',true,'already_linked',true,
        'provisional_only',true
      );
    end if;
    return pg_catalog.jsonb_build_object(
      'ok',false,'reason','guest_already_linked'
    );
  end if;

  if v_guest.review_status not in ('provisional','cleared') then
    return pg_catalog.jsonb_build_object(
      'ok',false,'reason','guest_under_review'
    );
  end if;

  insert into public.novelight_contest_readers (
    contest_id,kind,user_id
  ) values (v_contest.id,'account',p_user_id)
  on conflict do nothing;

  select * into v_account
    from public.novelight_contest_readers
   where contest_id = v_contest.id and kind = 'account'
     and user_id = p_user_id
   for update;
  if v_account.id is null or
     v_account.review_status in ('review_hold','excluded','merged') then
    return pg_catalog.jsonb_build_object(
      'ok',false,'reason','account_under_review'
    );
  end if;

  -- Re-open any previous clearance: merged claims require fresh stage-07
  -- review. Qualifying points remain provisional, never final/prize-cleared.
  update public.novelight_contest_readers
     set review_status = 'provisional',
         updated_at = v_now
   where id = v_account.id and review_status = 'cleared';

  update public.novelight_contest_readers
     set review_status = 'merged',
         merged_into_reader_id = v_account.id,
         updated_at = v_now
   where id = v_guest.id;

  update public.novelight_contest_read_sessions
     set status = 'excluded', updated_at = v_now
   where reader_id = v_guest.id and status = 'active';

  -- One account/episode unique key prevents double credit even if an account
  -- already qualified the same episode. Never promote excluded/held events.
  -- Never transfer a guest read of the signed-in author's own work.
  insert into public.novelight_contest_read_events (
    contest_id,reader_id,entry_id,episode_id_snapshot,
    first_session_id,qualified_at,status,rule_version,
    evidence_summary
  )
  select e.contest_id,v_account.id,e.entry_id,e.episode_id_snapshot,
         e.first_session_id,e.qualified_at,'provisional',
         'november-2026-points-v1',
         pg_catalog.jsonb_build_object(
           'source','guest_account_link','original_event_id',e.id
         )
    from public.novelight_contest_read_events e
    join public.novelight_contest_entries entry
      on entry.id = e.entry_id and entry.contest_id = v_contest.id
   where e.contest_id = v_contest.id and e.reader_id = v_guest.id
     and e.status in ('provisional','accepted')
     and entry.author_id <> p_user_id
  on conflict (contest_id,reader_id,episode_id_snapshot) do nothing;
  get diagnostics v_inserted = row_count;

  -- Remove source credit AND rebuild target 0/1/3/5 from distinct episodes.
  -- This is one SQL transaction: no intermediate double score is observable.
  for v_entry_id in
    select distinct entry_id
      from public.novelight_contest_read_events
     where contest_id = v_contest.id and reader_id = v_guest.id
    union
    select distinct entry_id
      from public.novelight_contest_reader_scores
     where contest_id = v_contest.id and reader_id = v_guest.id
  loop
    perform public.novelight_contest_recompute_reader_score(
      v_contest.id,v_guest.id,v_entry_id
    );
    perform public.novelight_contest_recompute_reader_score(
      v_contest.id,v_account.id,v_entry_id
    );
  end loop;

  insert into public.novelight_contest_review_audit (
    contest_id,reader_id,actor_user_id,action,reason_code,
    evidence_summary
  ) values (
    v_contest.id,v_account.id,p_user_id,
    'guest_account_link_provisional','signed_guest_and_verified_auth',
    pg_catalog.jsonb_build_object(
      'guest_reader_id',v_guest.id,'copied_episodes',v_inserted
    )
  );

  return pg_catalog.jsonb_build_object(
    'ok',true,'linked',true,'already_linked',false,
    'provisional_only',true,'copied_episodes',v_inserted
  );
end
$link$;

revoke all on function
  public.novelight_contest_link_guest_account(uuid,text,uuid)
  from public,anon,authenticated;
grant execute on function
  public.novelight_contest_link_guest_account(uuid,text,uuid)
  to service_role;

commit;
