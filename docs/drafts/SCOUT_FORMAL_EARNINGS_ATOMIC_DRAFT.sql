-- FORMAL-RELEASE DRAFT ONLY. NOT A MIGRATION. DO NOT APPLY.
-- Requires separate OWNER approval for launch, rate timing, valid comment policy,
-- review/correction policy, reward budget, and calendar month boundary.
-- This script is deliberately not under supabase/migrations.
-- It reuses public.valid_read_events, public.novel_comments,
-- public.scout_point_ledger, and the private formal state row lock.
-- No cron, client endpoints, or live Point grants are enabled by this file.


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

create or replace function novelight_formal_private.capture_read_level_draft(
 p_read_event_id uuid, p_release_at timestamptz
) returns jsonb
language plpgsql security definer set search_path=''
as $capture_read$
declare
 v_read public.valid_read_events%rowtype;
 v_state novelight_formal_private.scout_level_state%rowtype;
 v_qualified_tx bigint;
 v_id uuid;
begin
 if p_release_at is null or p_release_at>clock_timestamp() then
   return jsonb_build_object('status','release_not_verified');
 end if;
 select * into v_read from public.valid_read_events where id=p_read_event_id;
 if not found then return jsonb_build_object('status','valid_read_missing'); end if;
 if v_read.qualified_at<p_release_at or v_read.reader_id=v_read.author_id_snapshot then
   return jsonb_build_object('status','read_not_eligible');
 end if;
 -- The valid_read_events row must be newly inserted by THIS database
 -- transaction, not merely have a recent timestamp supplied by another path.
 select xmin::text::bigint into v_qualified_tx
 from public.valid_read_events where id=v_read.id;
 if v_qualified_tx is distinct from txid_current() then
   return jsonb_build_object('status','read_transaction_not_matched');
 end if;
 -- Capture must happen alongside the validated read transaction. Past events
 -- cannot be re-priced without an independently verified historical snapshot.
 if v_read.qualified_at<transaction_timestamp()-interval '30 seconds' or
    v_read.qualified_at>clock_timestamp() then
   return jsonb_build_object('status','historical_level_evidence_missing');
 end if;
 select * into v_state from novelight_formal_private.scout_level_state
 where user_id=v_read.reader_id for update;
 if not found then return jsonb_build_object('status','formal_state_missing'); end if;
 insert into novelight_formal_private.scout_read_level_evidence(
   read_event_id,reader_id,qualified_at,scout_level,level_revision
 ) values (v_read.id,v_read.reader_id,v_read.qualified_at,
           v_state.current_level,v_state.revision)
 on conflict(read_event_id) do nothing returning read_event_id into v_id;
 if v_id is null then return jsonb_build_object('status','evidence_already_present'); end if;
 return jsonb_build_object('status','captured','level',v_state.current_level);
end
$capture_read$;

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

revoke all on function novelight_formal_private.capture_read_level_draft(uuid,timestamptz)
 from public,anon,authenticated;
revoke all on function novelight_formal_private.award_read_points_draft(uuid,timestamptz)
 from public,anon,authenticated;
revoke all on function novelight_formal_private.award_comment_points_draft(uuid,timestamptz)
 from public,anon,authenticated;
grant execute on function novelight_formal_private.capture_read_level_draft(uuid,timestamptz)
 to service_role;
grant execute on function novelight_formal_private.award_read_points_draft(uuid,timestamptz)
 to service_role;
grant execute on function novelight_formal_private.award_comment_points_draft(uuid,timestamptz)
 to service_role;

commit;
