-- NOVELIGHT phase ⑤: FORMAL-ONLY OFFLINE DRAFT. NOT A MIGRATION; DO NOT APPLY.
-- Extracted from existing PR #2762; no new Point currency, audit or authentication system.
-- Canonical source: public.scout_point_ledger. Private usage Wallet is NOT live.
-- Prerequisites at separately approved formal cutover: approved 10x Point unit,
-- initialized and reconciled formal wallets and Level state, authoritative
-- read-time Level and comment moderation evidence tables, verified release time.
-- This file is intentionally outside supabase/migrations and is NOT wired to
-- an API, cron, workflow, beta trigger, connection, or public route.
-- Existing wallet and credit-claim definitions are reproduced from the draft;
-- no new wallet rows, historic balance conversion or actual Point awards occur.
-- The future restricted server executor must be independently approved.

create schema if not exists novelight_formal_private;

create table if not exists novelight_formal_private.scout_point_usage_wallets (
  user_id uuid primary key references auth.users(id) on delete restrict,
  available_points bigint not null default 0 check (available_points >= 0),
  exchange_eligible_points bigint not null default 0
    check (exchange_eligible_points >= 0),
  reserved_points bigint not null default 0 check (reserved_points >= 0),
  held_points bigint not null default 0 check (held_points >= 0),
  revision bigint not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now(),
  constraint scout_usage_eligible_subset
    check (exchange_eligible_points <= available_points),
  constraint scout_usage_int_safe
    check (available_points <= 9007199254740991
      and exchange_eligible_points <= 9007199254740991
      and reserved_points <= 9007199254740991)
);

create table if not exists novelight_formal_private.scout_point_usage_credit_claims (
  canonical_point_id uuid primary key references public.scout_point_ledger(id)
    on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  amount_points integer not null check (amount_points > 0),
  credited_at timestamptz not null default now()
);

alter table novelight_formal_private.scout_point_usage_wallets
  enable row level security;
alter table novelight_formal_private.scout_point_usage_credit_claims
  enable row level security;
revoke all on table
  novelight_formal_private.scout_point_usage_wallets,
  novelight_formal_private.scout_point_usage_credit_claims
  from public, anon, authenticated, service_role;

-- REUSED: idempotent mirror of one confirmed, eligible, post-release Point row.
-- It requires an already-initialized wallet and locks the canonical row and wallet.
-- Legacy beta Point is never exchanged by this writer.
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

-- REUSED: inserting the canonical Point and mirroring the wallet happen within
-- the same PostgreSQL function call/transaction. Any failed credit aborts both.
-- Authority is the pre-existing valid_read_events and server-captured Level.
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

-- REUSED: reviewed episode comments use canonical qualified-read evidence,
-- unique user+episode award keys and the 50-per-JST-month cap.
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

-- No default PUBLIC/anon/authenticated/service_role EXECUTE permission.
-- Deployment approval must separately decide a restricted, trusted server role.
revoke all on function
  novelight_formal_private.credit_confirmed_formal_point_draft(uuid,timestamptz),
  novelight_formal_private.award_read_points_draft(uuid,timestamptz),
  novelight_formal_private.award_comment_points_draft(uuid,timestamptz)
  from public, anon, authenticated, service_role;

-- No trigger, grant, table seeding, backfill, money/AI redemption, or cutover.
