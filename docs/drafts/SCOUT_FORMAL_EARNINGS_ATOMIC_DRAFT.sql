-- FORMAL-RELEASE DRAFT ONLY. NOT A MIGRATION. DO NOT APPLY.
-- Requires separate OWNER approval for launch, rate timing, valid comment policy,
-- review/correction policy, reward budget, and calendar month boundary.
-- This script is deliberately not under supabase/migrations.
-- It reuses public.valid_read_events, public.novel_comments,
-- public.scout_point_ledger, and the private formal state row lock.
-- No cron, client endpoints, or live Point grants are enabled by this file.

begin;

create or replace function novelight_formal_private.award_read_points_draft(
  p_read_event_id uuid,
  p_release_at timestamptz,
  p_level_rate_policy_approved boolean default false
) returns jsonb
language plpgsql security definer
set search_path = ''
as $award_read$
declare
  v_read public.valid_read_events%rowtype;
  v_state novelight_formal_private.scout_level_state%rowtype;
  v_points integer;
  v_key text;
  v_inserted uuid;
begin
  if p_release_at is null or p_release_at > clock_timestamp()
     or p_level_rate_policy_approved is distinct from true then
    return jsonb_build_object('status','rate_policy_pending');
  end if;
  select * into v_read from public.valid_read_events where id=p_read_event_id;
  if not found then return jsonb_build_object('status','valid_read_missing'); end if;
  if v_read.qualified_at < p_release_at then
    return jsonb_build_object('status','pre_release_not_eligible');
  end if;
  if v_read.reader_id is null or v_read.reader_id=v_read.author_id_snapshot then
    return jsonb_build_object('status','invalid_reader');
  end if;
  -- Lock the same per-user row used by formal XP and 30-day review.
  select * into v_state from novelight_formal_private.scout_level_state
   where user_id=v_read.reader_id for update;
  if not found then return jsonb_build_object('status','formal_level_unavailable'); end if;
  v_key:='formal_read_reward:'||v_read.id::text;
  if exists(select 1 from public.scout_point_ledger where event_key=v_key) then
    return jsonb_build_object('status','already_recorded');
  end if;
  -- At-claim-time pricing is NOT yet an OWNER decision. The explicit gate
  -- above must stay disabled until price-time treatment is approved.
  v_points:=case
    when v_state.current_level < 20 then 1
    when v_state.current_level < 40 then 2
    when v_state.current_level < 60 then 3
    when v_state.current_level < 70 then 4
    when v_state.current_level < 75 then 5
    when v_state.current_level < 80 then 6
    when v_state.current_level < 85 then 7
    when v_state.current_level < 90 then 8
    when v_state.current_level < 95 then 9
    when v_state.current_level < 100 then 10
    else 11 end;
  insert into public.scout_point_ledger (
    user_id,point_kind,point_value,status,event_key,occurred_at,metadata
  ) values (
    v_read.reader_id,'formal_read_reward',v_points,'confirmed',v_key,
    v_read.qualified_at,
    pg_catalog.jsonb_build_object(
      'read_event_id',v_read.id,'episode_id_snapshot',v_read.episode_id_snapshot,
      'scout_level',v_state.current_level,'rate_rule','formal-10point-yen-v1',
      'rate_basis','claim_level_pending_owner_approval'
    )
  ) on conflict(event_key) do nothing returning id into v_inserted;
  if v_inserted is null then return jsonb_build_object('status','already_recorded'); end if;
  return jsonb_build_object('status','recorded','points',v_points,'event_key',v_key);
end
$award_read$;

create or replace function novelight_formal_private.award_comment_points_draft(
  p_comment_id uuid,
  p_release_at timestamptz,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_policy_month text,
  p_comment_eligibility_approved boolean default false,
  p_comment_evidence_verified boolean default false,
  p_month_boundary_approved boolean default false
) returns jsonb
language plpgsql security definer
set search_path = ''
as $award_comment$
declare
  v_comment public.novel_comments%rowtype;
  v_state novelight_formal_private.scout_level_state%rowtype;
  v_count bigint;
  v_key text;
  v_inserted uuid;
begin
  -- Caller cannot grant a comment reward before OWNER has approved its policy.
  -- Flags are meaningful ONLY for the future trusted service_role executor.
  if p_comment_eligibility_approved is distinct from true or
     p_comment_evidence_verified is distinct from true or
     p_month_boundary_approved is distinct from true then
    return jsonb_build_object('status','comment_policy_pending');
  end if;
  if p_release_at is null or p_release_at > clock_timestamp() or
     p_period_start is null or p_period_end is null or
     p_period_start >= p_period_end or
     p_period_end-p_period_start > interval '32 days' or
     p_policy_month is null or
     pg_catalog.char_length(p_policy_month) not between 1 and 32 then
    return jsonb_build_object('status','month_policy_invalid');
  end if;
  select * into v_comment from public.novel_comments where id=p_comment_id;
  if not found then return jsonb_build_object('status','comment_missing'); end if;
  if v_comment.user_id is null or v_comment.deleted_at is not null or
     v_comment.author_hidden_at is not null then
    return jsonb_build_object('status','comment_not_eligible');
  end if;
  if v_comment.created_at < p_release_at then
    return jsonb_build_object('status','pre_release_not_eligible');
  end if;
  if v_comment.created_at < p_period_start or
     v_comment.created_at >= p_period_end then
    return jsonb_build_object('status','comment_outside_policy_month');
  end if;
  -- This same row lock serializes all award attempts for one reader,
  -- including simultaneous attempts for distinct comments near the 50 cap.
  select * into v_state from novelight_formal_private.scout_level_state
   where user_id=v_comment.user_id for update;
  if not found then return jsonb_build_object('status','formal_level_unavailable'); end if;
  v_key:='formal_comment_reward:'||v_comment.id::text;
  if exists(select 1 from public.scout_point_ledger where event_key=v_key) then
    return jsonb_build_object('status','already_recorded');
  end if;
  select count(*) into v_count from public.scout_point_ledger
   where user_id=v_comment.user_id and point_kind='formal_comment_reward'
     and event_key like 'formal_comment_reward:%'
     and occurred_at>=p_period_start and occurred_at<p_period_end;
  -- Count all previously recorded statuses: cancellation/hold and policy for
  -- re-issuance are NOT approved; do not open a 51st slot by cancellation.
  if v_count>=50 then
    return jsonb_build_object('status','monthly_comment_cap_reached');
  end if;
  insert into public.scout_point_ledger(
    user_id,point_kind,point_value,status,event_key,occurred_at,metadata
  ) values (
    v_comment.user_id,'formal_comment_reward',20,'confirmed',v_key,
    v_comment.created_at,
    pg_catalog.jsonb_build_object(
      'comment_id',v_comment.id,'policy_month',p_policy_month,
      'policy_window_start',p_period_start,'policy_window_end',p_period_end,
      'rate_rule','formal-10point-yen-v1'
    )
  ) on conflict(event_key) do nothing returning id into v_inserted;
  if v_inserted is null then return jsonb_build_object('status','already_recorded'); end if;
  return jsonb_build_object('status','recorded','points',20,
    'month_count',v_count+1,'event_key',v_key);
end
$award_comment$;

revoke all on function novelight_formal_private.award_read_points_draft(
  uuid,timestamptz,boolean) from public,anon,authenticated;
revoke all on function novelight_formal_private.award_comment_points_draft(
  uuid,timestamptz,timestamptz,timestamptz,text,boolean,boolean,boolean)
  from public,anon,authenticated;
grant execute on function novelight_formal_private.award_read_points_draft(
  uuid,timestamptz,boolean) to service_role;
grant execute on function novelight_formal_private.award_comment_points_draft(
  uuid,timestamptz,timestamptz,timestamptz,text,boolean,boolean,boolean)
  to service_role;

commit;
