-- Stage 07: contest-only operator review. No automatic decisions or awards.
-- Requires a separately scoped Production approval; do not activate contest.
begin;
select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtext('novelight:20261013183000:manual-review')
);

create or replace function public.novelight_contest_admin_review_reader(
  p_contest_id uuid,
  p_reader_id uuid,
  p_admin_user_id uuid,
  p_action text,
  p_expected_status text,
  p_reason_code text,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $review$
declare
  v_reader public.novelight_contest_readers%rowtype;
  v_contest uuid;
  v_next_status text;
  v_entry_id uuid;
  v_changed integer := 0;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_contest_id is null or p_reader_id is null or p_admin_user_id is null
     or p_action not in ('hold','clear','reopen')
     or p_expected_status not in ('provisional','review_hold','cleared')
     or p_reason_code not in (
       'anomalous_reading','duplicate_identity','manual_evidence',
       'appeal_review','false_positive','other'
     )
     or p_note is null or pg_catalog.char_length(pg_catalog.btrim(p_note)) < 20
     or pg_catalog.char_length(p_note) > 500
  then
    return pg_catalog.jsonb_build_object('ok',false,'reason','invalid_request');
  end if;
  v_next_status := case p_action
    when 'hold' then 'review_hold'
    when 'clear' then 'cleared'
    when 'reopen' then 'provisional'
  end;
  if v_next_status = p_expected_status then
    return pg_catalog.jsonb_build_object('ok',false,'reason','unchanged');
  end if;
  if p_action = 'clear' and p_reason_code not in (
    'manual_evidence','appeal_review','false_positive'
  ) then
    return pg_catalog.jsonb_build_object('ok',false,'reason','reason_not_sufficient');
  end if;

  select id into v_contest from public.novelight_contests
   where id = p_contest_id and contest_key = 'novelight-november-2026';
  if v_contest is null then
    return pg_catalog.jsonb_build_object('ok',false,'reason','contest_not_found');
  end if;

  -- Serialize review with guest-link / scoring writers. Stale UI changes
  -- are rejected and existing excluded or merged readers never reactivated.
  select * into v_reader from public.novelight_contest_readers
   where id = p_reader_id and contest_id = p_contest_id
   for update;
  if v_reader.id is null then
    return pg_catalog.jsonb_build_object('ok',false,'reason','reader_not_found');
  end if;
  if v_reader.review_status <> p_expected_status then
    return pg_catalog.jsonb_build_object(
      'ok',false,'reason','stale_review',
      'current_status',v_reader.review_status
    );
  end if;
  if v_reader.review_status in ('excluded','merged') then
    return pg_catalog.jsonb_build_object('ok',false,'reason','immutable_reader');
  end if;

  update public.novelight_contest_readers
     set review_status = v_next_status,
         updated_at = v_now
   where id = p_reader_id and contest_id = p_contest_id;

  -- Recompute every existing work score as part of the SAME transaction.
  -- review_hold suppresses credited episodes/points. Clearing is an
  -- operator disposition only, not a cash/prize eligibility decision.
  for v_entry_id in
    select distinct entry_id from public.novelight_contest_read_events
     where contest_id = p_contest_id and reader_id = p_reader_id
    union
    select distinct entry_id from public.novelight_contest_reader_scores
     where contest_id = p_contest_id and reader_id = p_reader_id
  loop
    perform public.novelight_contest_recompute_reader_score(
      p_contest_id,p_reader_id,v_entry_id
    );
    v_changed := v_changed + 1;
  end loop;

  insert into public.novelight_contest_review_audit (
    contest_id,reader_id,actor_user_id,action,reason_code,evidence_summary
  ) values (
    p_contest_id,p_reader_id,p_admin_user_id,
    'operator_review_' || p_action,p_reason_code,
    pg_catalog.jsonb_build_object(
      'from_status',v_reader.review_status,
      'to_status',v_next_status,
      'operator_note',pg_catalog.btrim(p_note),
      'recomputed_entries',v_changed,
      'provisional_only',true
    )
  );

  return pg_catalog.jsonb_build_object(
    'ok',true,'reader_id',p_reader_id,'review_status',v_next_status,
    'previous_status',v_reader.review_status,
    'recomputed_entries',v_changed,'provisional_only',true
  );
end
$review$;

revoke all on function
  public.novelight_contest_admin_review_reader(
    uuid,uuid,uuid,text,text,text,text
  ) from public,anon,authenticated;
grant execute on function
  public.novelight_contest_admin_review_reader(
    uuid,uuid,uuid,text,text,text,text
  ) to service_role;

commit;
