-- NOVELIGHT formal earning functions. PREPARATION ONLY; DO NOT APPLY WITHOUT A NEW OWNER APPROVAL.
-- Extracted verbatim from the already-reviewed two source drafts at PR #2762.
-- Prerequisite: LEVEL 3 + Point usage 5 + Earning 4 private tables exist.
-- NO TRIGGERS, NO GRANTS, NO JOBS, NO DATA INSERTS, NO LIVE REWARDS.
-- Security-definer functions are installed with EXECUTE denied to public/client/service roles.
-- Function creation approval is separate from activation and production cutover.

create or replace function novelight_formal_private.credit_confirmed_formal_point_draft(
  p_canonical_point_id uuid, p_formal_release_at timestamptz
) returns jsonb
language plpgsql security definer set search_path=''
as $formal_point_credit$
declare
  v_point public.scout_point_ledger%rowtype;
  v_wallet novelight_formal_private.scout_point_usage_wallets%rowtype;
  v_inserted uuid;
begin
  if p_canonical_point_id is null or p_formal_release_at is null
     or p_formal_release_at > clock_timestamp() then
    raise exception 'Trusted formal release and canonical Point required';
  end if;
  select * into v_point from public.scout_point_ledger
    where id=p_canonical_point_id and status='confirmed' for update;
  if not found or v_point.point_value <= 0 or
     v_point.occurred_at < p_formal_release_at or
     not (
       v_point.point_kind in ('formal_read_reward','formal_comment_reward') or
       (v_point.point_kind='level_up' and
        v_point.metadata->>'rule_version'='formal-scout-level-100-owner-20261110')
     ) then
    raise exception 'Canonical Point is not an eligible formal issuance';
  end if;
  select * into v_wallet from novelight_formal_private.scout_point_usage_wallets
    where user_id=v_point.user_id for update;
  if not found then
    raise exception 'Formal wallet cutover not initialized';
  end if;
  insert into novelight_formal_private.scout_point_usage_credit_claims(
    canonical_point_id,user_id,amount_points
  ) values(v_point.id,v_point.user_id,v_point.point_value)
  on conflict(canonical_point_id) do nothing
  returning canonical_point_id into v_inserted;
  if v_inserted is null then
    return jsonb_build_object('status','already_credited');
  end if;
  update novelight_formal_private.scout_point_usage_wallets
    set available_points=available_points+v_point.point_value,
        exchange_eligible_points=exchange_eligible_points+v_point.point_value,
        revision=revision+1,
        updated_at=now()
    where user_id=v_point.user_id;
  if not found then
    raise exception 'Formal wallet credit not persisted';
  end if;
  return jsonb_build_object('status','credited','amount_points',v_point.point_value);
end
$formal_point_credit$;

create or replace function novelight_formal_private.award_read_points_draft(
 p_read_event_id uuid, p_release_at timestamptz
) returns jsonb
language plpgsql security definer set search_path=''
as $award_read$
declare
 v_read public.valid_read_events%rowtype;
 v_ev novelight_formal_private.scout_read_level_evidence%rowtype;
 v_state novelight_formal_private.scout_level_state%rowtype;
 v_points integer;
 v_key text;
 v_inserted uuid;
begin
 if p_release_at is null or p_release_at>clock_timestamp() then
   return jsonb_build_object('status','release_not_verified');
 end if;
 select * into v_read from public.valid_read_events where id=p_read_event_id;
 if not found then return jsonb_build_object('status','valid_read_missing'); end if;
 if v_read.qualified_at < p_release_at then
   return jsonb_build_object('status','pre_release_not_eligible');
 end if;
 if v_read.reader_id=v_read.author_id_snapshot then
   return jsonb_build_object('status','self_read_ineligible');
 end if;
 select * into v_state from novelight_formal_private.scout_level_state
 where user_id=v_read.reader_id for update;
 if not found then return jsonb_build_object('status','formal_state_missing'); end if;
 select * into v_ev from novelight_formal_private.scout_read_level_evidence
 where read_event_id=v_read.id and reader_id=v_read.reader_id
   and qualified_at=v_read.qualified_at;
 if not found then return jsonb_build_object('status','read_time_level_unverified'); end if;
 v_key:='formal_read_reward:'||v_read.id::text;
 if exists(select 1 from public.scout_point_ledger where event_key=v_key) then
   return jsonb_build_object('status','already_recorded');
 end if;
 v_points:=case
   when v_ev.scout_level<20 then 1
   when v_ev.scout_level<40 then 2
   when v_ev.scout_level<60 then 3
   when v_ev.scout_level<70 then 4
   when v_ev.scout_level<75 then 5
   when v_ev.scout_level<80 then 6
   when v_ev.scout_level<85 then 7
   when v_ev.scout_level<90 then 8
   when v_ev.scout_level<95 then 9
   when v_ev.scout_level<100 then 10 else 11 end;
 insert into public.scout_point_ledger(
  user_id,point_kind,point_value,status,event_key,occurred_at,metadata
 ) values(
  v_read.reader_id,'formal_read_reward',v_points,'confirmed',v_key,
  v_read.qualified_at,
  pg_catalog.jsonb_build_object(
    'read_event_id',v_read.id,'episode_id_snapshot',v_read.episode_id_snapshot,
    'scout_level_at_read',v_ev.scout_level,'level_revision_at_read',v_ev.level_revision,
    'rate_rule','formal-owner-20261110')
 ) on conflict(event_key) do nothing returning id into v_inserted;
 if v_inserted is null then return jsonb_build_object('status','already_recorded'); end if;
 -- Canonical reward + private usable balance share the same transaction.
 perform novelight_formal_private.credit_confirmed_formal_point_draft(v_inserted,p_release_at);
 return jsonb_build_object('status','recorded','points',v_points,'event_key',v_key);
end
$award_read$;

create or replace function novelight_formal_private.award_comment_points_draft(
 p_comment_id uuid,p_release_at timestamptz
) returns jsonb
language plpgsql security definer set search_path=''
as $award_comment$
declare
 v_comment public.novel_comments%rowtype;
 v_level novelight_formal_private.scout_level_state%rowtype;
 v_novel_author uuid;
 v_read uuid;
 v_attest boolean;
 v_review novelight_formal_private.scout_comment_review_evidence%rowtype;
 v_month_start timestamp without time zone;
 v_count bigint;
 v_key text;
 v_inserted uuid;
begin
 if p_release_at is null or p_release_at>clock_timestamp() then
   return jsonb_build_object('status','release_not_verified');
 end if;
 select * into v_comment from public.novel_comments
 where id=p_comment_id for update;
 if not found then return jsonb_build_object('status','comment_missing'); end if;
 if v_comment.episode_id is null or v_comment.deleted_at is not null or
    v_comment.author_hidden_at is not null or
    char_length(btrim(v_comment.body))=0 then
   return jsonb_build_object('status','comment_not_eligible');
 end if;
 if v_comment.created_at < p_release_at then
   return jsonb_build_object('status','pre_release_not_eligible');
 end if;
 if v_comment.created_at>clock_timestamp() then
   return jsonb_build_object('status','future_comment_not_eligible');
 end if;
 select n.user_id into v_novel_author from public.novels n
 where n.id=v_comment.novel_id;
 if v_novel_author is null or v_novel_author=v_comment.user_id then
   return jsonb_build_object('status','self_or_missing_author');
 end if;
 if not exists(
  select 1 from public.episodes e
  where e.id=v_comment.episode_id and e.novel_id=v_comment.novel_id
 ) then return jsonb_build_object('status','episode_novel_mismatch'); end if;
 -- The unique existing valid_read_events(reader_id,episode_id_snapshot)
 -- constraint is authoritative qualification evidence for this episode.
 select id into v_read from public.valid_read_events
 where reader_id=v_comment.user_id
   and episode_id_snapshot=v_comment.episode_id::text
   and qualified_at<=v_comment.created_at
 limit 1;
 if v_read is null then return jsonb_build_object('status','valid_read_required'); end if;
 select eligible into v_attest from novelight_formal_private.scout_comment_eligibility
 where comment_id=v_comment.id;
 if v_attest is distinct from true then
   return jsonb_build_object('status','content_review_pending_or_rejected');
 end if;
 select * into v_review from novelight_formal_private.scout_comment_review_evidence
 where comment_id=v_comment.id;
 if not found or v_review.eligible is distinct from true then
   return jsonb_build_object('status','review_evidence_missing');
 end if;
 -- No Point if the content reviewed was changed before awarding.
 -- Retroactive cancellation after award remains an OWNER policy decision.
 if v_review.comment_user_id <> v_comment.user_id or
    v_review.episode_id <> v_comment.episode_id or
    v_review.body_sha256 <> pg_catalog.encode(
      pg_catalog.sha256(pg_catalog.convert_to(v_comment.body,'UTF8')),'hex') then
   return jsonb_build_object('status','review_source_changed_requires_owner_policy');
 end if;
 -- First eligible means earliest eligible *chapter* comment by server timestamp.
 -- Hold later comments while earlier visible qualifying comments remain
 -- unreviewed, rather than rewarding a later comment and then an earlier one.
 if exists(
   select 1 from public.novel_comments prior
   left join novelight_formal_private.scout_comment_eligibility review
     on review.comment_id=prior.id
   where prior.user_id=v_comment.user_id
     and prior.episode_id=v_comment.episode_id
     and (prior.created_at,prior.id)<(v_comment.created_at,v_comment.id)
     and prior.deleted_at is null and prior.author_hidden_at is null
     and prior.created_at>=p_release_at
     and exists(select 1 from public.valid_read_events earlier_read
       where earlier_read.reader_id=prior.user_id
         and earlier_read.episode_id_snapshot=prior.episode_id::text
         and earlier_read.qualified_at<=prior.created_at)
     and review.eligible is null
 ) then return jsonb_build_object('status','earlier_comment_review_pending'); end if;
 if exists(
   select 1 from public.novel_comments prior
   join novelight_formal_private.scout_comment_eligibility review
     on review.comment_id=prior.id and review.eligible=true
   where prior.user_id=v_comment.user_id
     and prior.episode_id=v_comment.episode_id
     and (prior.created_at,prior.id)<(v_comment.created_at,v_comment.id)
     and prior.deleted_at is null and prior.author_hidden_at is null
     and exists(select 1 from public.valid_read_events earlier_read
       where earlier_read.reader_id=prior.user_id
         and earlier_read.episode_id_snapshot=prior.episode_id::text
         and earlier_read.qualified_at<=prior.created_at)
 ) then return jsonb_build_object('status','earlier_eligible_comment_exists'); end if;

 -- Serialize both monthly quota and reader/episode dedupe on one state row.
 select * into v_level from novelight_formal_private.scout_level_state
 where user_id=v_comment.user_id for update;
 if not found then return jsonb_build_object('status','formal_state_missing'); end if;
 -- Enforce JST month server-side; no caller-controlled calendar boundaries.
 v_month_start:=date_trunc('month',v_comment.created_at at time zone 'Asia/Tokyo');
 v_key:='formal_comment_reward:'||v_comment.user_id::text||':'||v_comment.episode_id::text;
 if exists(select 1 from public.scout_point_ledger where event_key=v_key) then
   return jsonb_build_object('status','already_recorded_for_episode');
 end if;
 select count(*) into v_count from public.scout_point_ledger
 where user_id=v_comment.user_id and point_kind='formal_comment_reward'
   and occurred_at >= (v_month_start at time zone 'Asia/Tokyo')
   and occurred_at < ((v_month_start+interval '1 month') at time zone 'Asia/Tokyo');
 -- Count all recorded statuses to avoid refund/reversal policy being guessed.
 if v_count>=50 then return jsonb_build_object('status','monthly_comment_cap_reached'); end if;
 insert into public.scout_point_ledger(
  user_id,point_kind,point_value,status,event_key,occurred_at,metadata
 ) values(
  v_comment.user_id,'formal_comment_reward',20,'confirmed',v_key,
  v_comment.created_at,
  pg_catalog.jsonb_build_object(
    'comment_id',v_comment.id,'read_event_id',v_read,
    'episode_id',v_comment.episode_id,
    'policy_month_jst',to_char(v_month_start,'YYYY-MM'),
    'rate_rule','formal-owner-20261110')
 ) on conflict(event_key) do nothing returning id into v_inserted;
 if v_inserted is null then return jsonb_build_object('status','already_recorded_for_episode'); end if;
 perform novelight_formal_private.credit_confirmed_formal_point_draft(v_inserted,p_release_at);
 return jsonb_build_object('status','recorded','points',20,
   'month_count',v_count+1,'event_key',v_key);
end
$award_comment$;

create or replace function novelight_formal_private.review_comment_and_award_draft(
 p_comment_id uuid,
 p_release_at timestamptz,
 p_content_eligible boolean,
 p_reviewer_rule text
) returns jsonb
language plpgsql security definer set search_path=''
as $review_award$
declare
 v_comment public.novel_comments%rowtype;
 v_proof novelight_formal_private.scout_comment_review_evidence%rowtype;
 v_saved boolean;
 v_reward jsonb;
begin
 if p_content_eligible is null or p_reviewer_rule is null or
    char_length(p_reviewer_rule) not between 1 and 120 then
   return jsonb_build_object('status','review_evidence_missing');
 end if;
 select * into v_comment from public.novel_comments
 where id=p_comment_id for update;
 if not found then return jsonb_build_object('status','comment_missing'); end if;
 select * into v_proof from novelight_formal_private.scout_comment_review_evidence
 where comment_id=p_comment_id;
 if not found then return jsonb_build_object('status','review_evidence_missing'); end if;
 if v_proof.eligible is distinct from p_content_eligible or
    v_proof.reviewer_rule <> p_reviewer_rule then
   return jsonb_build_object('status','review_conflict_requires_owner_policy');
 end if;
 if v_proof.comment_user_id <> v_comment.user_id or
    v_proof.episode_id <> v_comment.episode_id or
    v_proof.body_sha256 <> pg_catalog.encode(
      pg_catalog.sha256(pg_catalog.convert_to(v_comment.body,'UTF8')),'hex') then
   return jsonb_build_object('status','review_source_changed_requires_owner_policy');
 end if;
 -- Immutable first moderation decision. Any later reversal is explicitly
 -- outside the current OWNER approval and cannot silently re-credit.
 insert into novelight_formal_private.scout_comment_eligibility(
   comment_id,eligible,reviewer_rule
 ) values(p_comment_id,p_content_eligible,p_reviewer_rule)
 on conflict(comment_id) do nothing;
 select eligible into v_saved from
   novelight_formal_private.scout_comment_eligibility
 where comment_id=p_comment_id;
 if v_saved is distinct from p_content_eligible then
   return jsonb_build_object('status','review_conflict_requires_owner_policy');
 end if;
 if v_saved is distinct from true then
   return jsonb_build_object('status','reviewed_not_eligible');
 end if;
 v_reward:=novelight_formal_private.award_comment_points_draft(p_comment_id,p_release_at);
 return v_reward;
end
$review_award$;

create or replace function novelight_formal_private.enqueue_earning_draft(
  p_event_type text,p_event_id uuid
) returns jsonb language plpgsql security definer set search_path=''
as $earning_enqueue$
declare v_state text;
begin
 if p_event_type not in ('valid_read_qualified','novel_episode_comment_reviewed')
    or p_event_id is null then
   return jsonb_build_object('status','unsupported_event');
 end if;
 if p_event_type='valid_read_qualified' and not exists(
   select 1 from public.valid_read_events where id=p_event_id
 ) then return jsonb_build_object('status','source_missing'); end if;
 if p_event_type='novel_episode_comment_reviewed' and not exists(
   select 1 from public.novel_comments where id=p_event_id
 ) then return jsonb_build_object('status','source_missing'); end if;
 insert into novelight_formal_private.scout_earning_delivery(
   event_type,event_id,state
 ) values(p_event_type,p_event_id,
   case when p_event_type='novel_episode_comment_reviewed'
        then 'review_pending' else 'pending' end)
 on conflict(event_type,event_id) do nothing;
 select state into v_state from novelight_formal_private.scout_earning_delivery
 where event_type=p_event_type and event_id=p_event_id;
 return jsonb_build_object('status',v_state);
end
$earning_enqueue$;

create or replace function novelight_formal_private.decide_earning_review_draft(
 p_comment_id uuid,p_eligible boolean,p_rule text,
 p_reviewer_user_id uuid,p_review_id uuid,p_body_sha256 text,p_episode_id bigint
) returns jsonb language plpgsql security definer set search_path=''
as $earning_review$
declare
 v_comment public.novel_comments%rowtype;
 v_state text;
 v_old novelight_formal_private.scout_comment_review_evidence%rowtype;
begin
 if p_comment_id is null or p_eligible is null or
    p_rule is null or char_length(p_rule) not between 1 and 120 or
    p_reviewer_user_id is null or p_review_id is null or
    p_body_sha256 is null or p_body_sha256 !~ '^[0-9a-f]{64}$' or
    p_episode_id is null or p_episode_id<=0 then
   return jsonb_build_object('status','review_missing');
 end if;
 select * into v_comment from public.novel_comments
 where id=p_comment_id for update;
 if not found then return jsonb_build_object('status','comment_missing'); end if;
 select state into v_state from novelight_formal_private.scout_earning_delivery
 where event_type='novel_episode_comment_reviewed'
   and event_id=p_comment_id for update;
 if not found then return jsonb_build_object('status','event_missing'); end if;
 -- Check the locked source before even an idempotent replay response.
 -- A previously reviewed but now edited source is not a valid replay.
 if v_comment.episode_id is distinct from p_episode_id or
    v_comment.body is null or
    pg_catalog.encode(
      pg_catalog.sha256(pg_catalog.convert_to(v_comment.body,'UTF8')),'hex'
    ) <> p_body_sha256 then
   return jsonb_build_object('status','review_source_changed');
 end if;
 if p_eligible and (v_comment.deleted_at is not null or
                    v_comment.author_hidden_at is not null) then
   return jsonb_build_object('status','review_source_unavailable');
 end if;
 -- No audit replacement or change of verdict, even when a second reviewer
 -- submits an identical outcome; the first provenance remains authoritative.
 select * into v_old from novelight_formal_private.scout_comment_review_evidence
 where comment_id=p_comment_id;
 if found then
   if v_old.reviewer_user_id=p_reviewer_user_id and
      v_old.eligible=p_eligible and v_old.reviewer_rule=p_rule and
      v_old.body_sha256=p_body_sha256 and v_old.episode_id=p_episode_id then
     return jsonb_build_object('status','review_already_recorded');
   end if;
   return jsonb_build_object('status','review_conflict_requires_owner_policy');
 end if;
 if v_state <> 'review_pending' then
   return jsonb_build_object('status','review_not_pending');
 end if;
 insert into novelight_formal_private.scout_comment_review_evidence(
  review_id,comment_id,reviewer_user_id,comment_user_id,
  episode_id,body_sha256,eligible,reviewer_rule
 ) values (
  p_review_id,p_comment_id,p_reviewer_user_id,v_comment.user_id,
  p_episode_id,p_body_sha256,p_eligible,p_rule
 );
 update novelight_formal_private.scout_earning_delivery
 set moderation_decision=p_eligible,moderation_rule=p_rule,
     state='pending',next_attempt_at=now(),updated_at=now()
 where event_type='novel_episode_comment_reviewed'
   and event_id=p_comment_id and state='review_pending'
   and moderation_decision is null;
 if not found then
   raise exception 'FORMAL_REVIEW_ATOMIC_CONFLICT';
 end if;
 return jsonb_build_object('status','review_recorded');
end
$earning_review$;

create or replace function novelight_formal_private.claim_earning_draft()
returns jsonb language plpgsql security definer set search_path=''
as $earning_claim$
declare v_row novelight_formal_private.scout_earning_delivery%rowtype;
declare v_token uuid;
begin
 select * into v_row
 from novelight_formal_private.scout_earning_delivery
 where ((state in ('pending','retry') and next_attempt_at<=now())
       or (state='leased' and leased_until<now()))
   and (event_type='valid_read_qualified' or moderation_decision is not null)
 order by next_attempt_at,created_at,event_id
 for update skip locked limit 1;
 if not found then return jsonb_build_object('status','no_due_event'); end if;
 v_token:=pg_catalog.gen_random_uuid();
 update novelight_formal_private.scout_earning_delivery
 set state='leased',lease_token=v_token,leased_until=now()+interval '5 minutes',
     attempt_count=attempt_count+1,updated_at=now()
 where event_type=v_row.event_type and event_id=v_row.event_id;
 return jsonb_build_object('status','leased','event_type',v_row.event_type,
   'event_id',v_row.event_id,'lease_token',v_token,
   'attempt_count',v_row.attempt_count+1,
   'moderation_decision',v_row.moderation_decision,
   'moderation_rule',v_row.moderation_rule);
end
$earning_claim$;

create or replace function novelight_formal_private.finish_earning_draft(
  p_event_type text,p_event_id uuid,p_token uuid,p_result text
) returns jsonb language plpgsql security definer set search_path=''
as $earning_finish$
declare v_final_state text;
declare v_retry boolean;
begin
 if p_result in ('recorded','already_recorded','already_recorded_for_episode',
                'reviewed_not_eligible','pre_release_not_eligible',
                'self_or_missing_author','monthly_comment_cap_reached') then
   v_final_state:='completed';v_retry:=false;
 elsif p_result in ('private_rpc_failed','formal_level_unavailable',
                    'formal_state_missing','read_time_level_unverified',
                    'earlier_comment_review_pending',
                    'content_review_pending_or_rejected') then
   v_final_state:='retry';v_retry:=true;
 else
   v_final_state:='held';v_retry:=false;
 end if;
 update novelight_formal_private.scout_earning_delivery
 set state=v_final_state,lease_token=null,leased_until=null,
     last_result=left(coalesce(p_result,'unknown'),100),
     next_attempt_at=case when v_retry then now()+interval '5 minutes'
                          else next_attempt_at end,
     updated_at=now()
 where event_type=p_event_type and event_id=p_event_id and
       lease_token=p_token and state='leased';
 if not found then return jsonb_build_object('status','lease_mismatch'); end if;
 return jsonb_build_object('status',v_final_state);
end
$earning_finish$;

create or replace function novelight_formal_private.on_valid_read_formal_draft()
returns trigger
language plpgsql security definer set search_path=''
as $capture_read$
declare
 v_state novelight_formal_private.scout_level_state%rowtype;
 v_award jsonb;
begin
 if new.reader_id=new.author_id_snapshot then return new; end if;
 select * into v_state from novelight_formal_private.scout_level_state
 where user_id=new.reader_id for update;
 if not found then return new; end if;
 insert into novelight_formal_private.scout_read_level_evidence(
  read_event_id,reader_id,qualified_at,scout_level,level_revision
 ) values (new.id,new.reader_id,new.qualified_at,
           v_state.current_level,v_state.revision)
 on conflict(read_event_id) do nothing;
 -- Release-scoped Level state is the authoritative earning start:
 -- beta accounts anchor at formal release, new accounts at registration.
 -- The same INSERT transaction now writes qualification, level evidence,
 -- and the first-time Point claim; no post-commit worker is required.
 v_award:=novelight_formal_private.award_read_points_draft(
   new.id,v_state.review_anchor_at
 );
 -- The canonical Point ledger is already the idempotency guard.
 -- Only a read whose initial award was held needs durable later replay.
 if v_award->>'status' not in ('recorded','already_recorded') then
   perform novelight_formal_private.enqueue_earning_draft(
     'valid_read_qualified',new.id
   );
 end if;
 return new;
end
$capture_read$;

create or replace function novelight_formal_private.on_episode_comment_formal_draft()
returns trigger language plpgsql security definer set search_path=''
as $comment_enqueue$
begin
 if new.episode_id is null then return new; end if;
 -- Chapter scope in the existing post RPC is finalized by a subsequent
 -- UPDATE. Only the first NULL -> non-NULL change is eligible to enqueue.
 if tg_op='UPDATE' then
   if old.episode_id is not null then return new; end if;
 end if;
 -- Do not discard a canonical comment when its formal Level state has not
 -- yet been initialized. Reward eligibility remains blocked until a trusted
 -- state exists, but the durable review record must not be lost.
 perform novelight_formal_private.enqueue_earning_draft(
   'novel_episode_comment_reviewed',new.id
 );
 return new;
end
$comment_enqueue$;

-- Keep every freshly created function non-callable by public/client/service roles.
revoke all on function novelight_formal_private.credit_confirmed_formal_point_draft(uuid,timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function novelight_formal_private.award_read_points_draft(uuid,timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function novelight_formal_private.award_comment_points_draft(uuid,timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function novelight_formal_private.review_comment_and_award_draft(uuid,timestamptz,boolean,text)
  from public, anon, authenticated, service_role;
revoke all on function novelight_formal_private.enqueue_earning_draft(text,uuid)
  from public, anon, authenticated, service_role;
revoke all on function novelight_formal_private.decide_earning_review_draft(uuid,boolean,text,uuid,uuid,text,bigint)
  from public, anon, authenticated, service_role;
revoke all on function novelight_formal_private.claim_earning_draft()
  from public, anon, authenticated, service_role;
revoke all on function novelight_formal_private.finish_earning_draft(text,uuid,uuid,text)
  from public, anon, authenticated, service_role;
revoke all on function novelight_formal_private.on_valid_read_formal_draft()
  from public, anon, authenticated, service_role;
revoke all on function novelight_formal_private.on_episode_comment_formal_draft()
  from public, anon, authenticated, service_role;
