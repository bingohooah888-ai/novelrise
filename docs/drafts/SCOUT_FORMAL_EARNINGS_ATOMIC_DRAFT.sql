-- FORMAL-RELEASE DRAFT ONLY. NOT A MIGRATION. DO NOT APPLY.
-- Requires separate OWNER approval for launch, rate timing, valid comment policy,
-- review/correction policy, reward budget, and calendar month boundary.
-- This script is deliberately not under supabase/migrations.
-- It reuses public.valid_read_events, public.novel_comments,
-- public.scout_point_ledger, and the private formal state row lock.
-- No cron, client endpoints, or live Point grants are enabled by this file.
-- The proposed read-capture trigger is release-only and is NEVER applied to beta.


begin;
-- The read-level snapshot MUST be captured by a server-side qualification
-- transaction, never reconstructed from the current Level later.
create table novelight_formal_private.scout_read_level_evidence (
 read_event_id uuid primary key references public.valid_read_events(id) on delete restrict,
 reader_id uuid not null references auth.users(id) on delete cascade,
 qualified_at timestamptz not null,
 scout_level smallint not null check (scout_level between 1 and 100),
 level_revision bigint not null check (level_revision>=0),
 captured_at timestamptz not null default clock_timestamp()
);
alter table novelight_formal_private.scout_read_level_evidence enable row level security;
revoke all on novelight_formal_private.scout_read_level_evidence from public,anon,authenticated;

-- A deliberate, server-reviewed eligibility decision for content/anti-spam.
-- Human/moderation outcome is not inferred by the database from length alone.
create table novelight_formal_private.scout_comment_eligibility (
 comment_id uuid primary key references public.novel_comments(id) on delete restrict,
 eligible boolean not null,
 reviewer_rule text not null check (char_length(reviewer_rule) between 1 and 120),
 verified_at timestamptz not null default clock_timestamp()
);
alter table novelight_formal_private.scout_comment_eligibility enable row level security;
revoke all on novelight_formal_private.scout_comment_eligibility from public,anon,authenticated;

-- The future-only trigger captures the Level in exactly the transaction
-- that creates an authoritative valid_read_events record. This works even
-- inside PostgreSQL savepoints/subtransactions, unlike comparing xmin/xid.
-- Do not activate the trigger until the separately approved formal cutover.
create or replace function novelight_formal_private.on_valid_read_formal_draft()
returns trigger
language plpgsql security definer set search_path=''
as $capture_read$
declare
 v_state novelight_formal_private.scout_level_state%rowtype;
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
 perform novelight_formal_private.award_read_points_draft(
   new.id,v_state.review_anchor_at
 );
 return new;
end
$capture_read$;

create trigger scout_formal_read_level_capture
after insert on public.valid_read_events
for each row execute function novelight_formal_private.on_valid_read_formal_draft();

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
 v_month_start timestamp without time zone;
 v_count bigint;
 v_key text;
 v_inserted uuid;
begin
 if p_release_at is null or p_release_at>clock_timestamp() then
   return jsonb_build_object('status','release_not_verified');
 end if;
 select * into v_comment from public.novel_comments where id=p_comment_id;
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
 return jsonb_build_object('status','recorded','points',20,
   'month_count',v_count+1,'event_key',v_key);
end
$award_comment$;


-- Trusted comment reviewer attests and awards inside ONE database transaction.
-- This function is never exposed as a public endpoint. Calling service must
-- separately review repetitive/irrelevant content; an author or browser must
-- never be allowed to supply the eligibility verdict.
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
 v_saved boolean;
 v_reward jsonb;
begin
 if p_content_eligible is null or p_reviewer_rule is null or
    char_length(p_reviewer_rule) not between 1 and 120 then
   return jsonb_build_object('status','review_evidence_missing');
 end if;
 select * into v_comment from public.novel_comments
 where id=p_comment_id;
 if not found then return jsonb_build_object('status','comment_missing'); end if;
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

revoke all on function novelight_formal_private.on_valid_read_formal_draft()
 from public,anon,authenticated;
revoke all on function novelight_formal_private.award_read_points_draft(uuid,timestamptz)
 from public,anon,authenticated;
revoke all on function novelight_formal_private.award_comment_points_draft(uuid,timestamptz)
 from public,anon,authenticated;
revoke all on function novelight_formal_private.review_comment_and_award_draft(
 uuid,timestamptz,boolean,text) from public,anon,authenticated;
grant execute on function novelight_formal_private.review_comment_and_award_draft(
 uuid,timestamptz,boolean,text) to service_role;
grant execute on function novelight_formal_private.on_valid_read_formal_draft()
 to service_role;
grant execute on function novelight_formal_private.award_read_points_draft(uuid,timestamptz)
 to service_role;
grant execute on function novelight_formal_private.award_comment_points_draft(uuid,timestamptz)
 to service_role;


-- Formal-only durable delivery state. It is NOT a new exchange ledger,
-- scheduler, public route, or beta migration. Canonical source rows and
-- public.scout_point_ledger remain the source of truth.
create table novelight_formal_private.scout_earning_delivery (
  event_type text not null check(event_type in ('valid_read_qualified','novel_episode_comment_reviewed')),
  event_id uuid not null,
  state text not null default 'pending'
    check(state in ('pending','review_pending','retry','leased','completed','held')),
  moderation_decision boolean,
  moderation_rule text,
  attempt_count integer not null default 0 check(attempt_count>=0),
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  leased_until timestamptz,
  last_result text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(event_type,event_id),
  check((lease_token is null and leased_until is null) or
        (lease_token is not null and leased_until is not null)),
  check(moderation_rule is null or char_length(moderation_rule) between 1 and 120)
);
alter table novelight_formal_private.scout_earning_delivery enable row level security;
revoke all on novelight_formal_private.scout_earning_delivery
 from public,anon,authenticated;

-- Re-enqueue is idempotent and cannot turn a terminal result into pending.
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

-- A trusted moderator resolves the existing pending decision.
-- No fake automatic semantic classification. No changes to settled verdicts.
create or replace function novelight_formal_private.decide_earning_review_draft(
  p_comment_id uuid,p_eligible boolean,p_rule text
) returns jsonb language plpgsql security definer set search_path=''
as $earning_review$
declare v_state text;
begin
 if p_comment_id is null or p_eligible is null or
    p_rule is null or char_length(p_rule) not between 1 and 120 then
   return jsonb_build_object('status','review_missing');
 end if;
 update novelight_formal_private.scout_earning_delivery
 set moderation_decision=p_eligible,moderation_rule=p_rule,
     state='pending',next_attempt_at=now(),updated_at=now()
 where event_type='novel_episode_comment_reviewed'
   and event_id=p_comment_id
   and state='review_pending'
   and moderation_decision is null;
 if found then return jsonb_build_object('status','review_recorded'); end if;
 select state into v_state from novelight_formal_private.scout_earning_delivery
 where event_type='novel_episode_comment_reviewed' and event_id=p_comment_id;
 return jsonb_build_object('status',coalesce(v_state,'event_missing'));
end
$earning_review$;

-- Explicit caller-initiated batch only: no timer, cron or automatic worker.
-- FOR UPDATE SKIP LOCKED ensures only one delivery owns a claim.
-- Expired leases recover after process crash; successful outcomes are never
-- reclaimed. A lease token prevents stale workers from finalizing a new lease.
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

-- Finalization never itself issues Points. A database ledger insert is
-- independently idempotent and precedes this status update in delivery.
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
                    'read_time_level_unverified','earlier_comment_review_pending',
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

revoke all on function novelight_formal_private.enqueue_earning_draft(text,uuid)
 from public,anon,authenticated;
revoke all on function novelight_formal_private.decide_earning_review_draft(uuid,boolean,text)
 from public,anon,authenticated;
revoke all on function novelight_formal_private.claim_earning_draft()
 from public,anon,authenticated;
revoke all on function novelight_formal_private.finish_earning_draft(text,uuid,uuid,text)
 from public,anon,authenticated;
grant execute on function novelight_formal_private.enqueue_earning_draft(text,uuid)
 to service_role;
grant execute on function novelight_formal_private.decide_earning_review_draft(uuid,boolean,text)
 to service_role;
grant execute on function novelight_formal_private.claim_earning_draft()
 to service_role;
grant execute on function novelight_formal_private.finish_earning_draft(text,uuid,uuid,text)
 to service_role;

commit;
