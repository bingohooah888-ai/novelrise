-- SCOUT LEVEL 100 formal-release ONLY: DRAFT, DO NOT APPLY to Staging beta or Production.
-- Prerequisite: separately approved formal release cutover, formal state initialized,
-- beta-to-formal migration verified, and one-time Level reward source switched.
-- The existing beta trigger remains active in every deployed environment until then.
-- This file is deliberately outside supabase/migrations.

begin;

-- Future release: remove the *beta XP cap and discovery exclusion* only at launch.
-- The existing trigger scout_xp_beta_level_cap remains attached, using this
-- replacement function. The historical beta record/ledger is never rewritten.
create or replace function public.novelight_cap_scout_xp_beta()
returns trigger
language plpgsql security definer set search_path = ''
as $formal_cutover$
begin
  -- Negative adjustment policy is unresolved: do not silently alter old ledger semantics.
  return new;
end
$formal_cutover$;


-- New readers need their formal state before the first authoritative XP event.
-- Do not attach an auth.users trigger before formal release approval.
create or replace function novelight_formal_private.initialize_new_reader(
  p_user_id uuid, p_release_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = ''
as $new_reader$
declare
  v_signup timestamptz;
  v_state novelight_formal_private.scout_level_state%rowtype;
begin
  if p_user_id is null or p_release_at is null or p_release_at > clock_timestamp() then
    raise exception 'Verified account and elapsed release timestamp required';
  end if;
  select created_at into v_signup from auth.users where id=p_user_id;
  if v_signup is null or v_signup < p_release_at or v_signup > clock_timestamp() then
    raise exception 'Not a post-release registered account';
  end if;
  insert into novelight_formal_private.scout_level_state(
    user_id,current_level,highest_level,level_progress_xp,review_anchor_at
  ) values(p_user_id,1,1,0,v_signup)
  on conflict(user_id) do nothing;
  select * into v_state from novelight_formal_private.scout_level_state
    where user_id=p_user_id;
  return jsonb_build_object('status','initialized_or_existing','level',v_state.current_level,
    'progress',v_state.level_progress_xp,'review_anchor',v_state.review_anchor_at);
end
$new_reader$;

revoke all on function novelight_formal_private.initialize_new_reader(uuid,timestamptz)
  from public, anon, authenticated;
grant execute on function novelight_formal_private.initialize_new_reader(uuid,timestamptz)
  to service_role;

-- The live beta Level reward trigger uses lifetime XP and must not coexist
-- with formal Level reward issuance after the release cutover.
drop trigger if exists scout_xp_level_up_points on public.scout_xp_ledger;

-- Extend the previously verified private state writer, without replacing its
-- existing XP claim/review locks or changing the cumulative historical XP ledger.
create or replace function novelight_formal_private.apply_scout_xp(
  p_xp_id uuid
) returns jsonb
language plpgsql security definer set search_path = ''
as $formal_progress$
declare
  v_xp public.scout_xp_ledger%rowtype;
  v_state novelight_formal_private.scout_level_state%rowtype;
  v_progress integer;
  v_level smallint;
  v_required integer;
  v_promoted smallint;
  v_point_id uuid;
begin
  select * into v_xp from public.scout_xp_ledger where id=p_xp_id;
  if not found then raise exception 'source XP row not found'; end if;
  select * into v_state from novelight_formal_private.scout_level_state
    where user_id=v_xp.user_id for update;
  if not found then raise exception 'formal state not initialized'; end if;
  if exists(select 1 from novelight_formal_private.scout_xp_claim where xp_id=p_xp_id) then
    return jsonb_build_object('status','already_applied');
  end if;
  if v_xp.xp_value <= 0 then return jsonb_build_object('status','adjustment_policy_pending'); end if;
  if v_xp.occurred_at < v_state.review_anchor_at or
     (v_state.last_review_end_at is not null and v_xp.occurred_at < v_state.last_review_end_at) then
    return jsonb_build_object('status','closed_or_pre_release_window');
  end if;
  if v_xp.occurred_at >= coalesce(v_state.last_review_end_at,v_state.review_anchor_at)
                                + interval '30 days' then
    return jsonb_build_object('status','review_due_first');
  end if;
  if v_state.current_level = 100 then
    return jsonb_build_object('status','level_100_surplus_policy_pending');
  end if;
  v_level := v_state.current_level;
  v_progress := v_state.level_progress_xp + v_xp.xp_value;
  if v_progress < 0 then raise exception 'XP integer overflow'; end if;
  while v_level < 100 loop
    if v_level < 30 then
      select next_t.cumulative_xp-current_t.cumulative_xp into v_required
        from public.scout_level_thresholds current_t
        join public.scout_level_thresholds next_t on next_t.level=current_t.level+1
       where current_t.level=v_level;
    else
      v_required := 400;
    end if;
    if v_required is null or v_required <= 0 then
      raise exception 'Formal threshold unavailable';
    end if;
    if v_progress < v_required then exit; end if;
    v_progress := v_progress-v_required;
    v_level := v_level+1;
  end loop;
  if v_level=100 and v_progress>0 then
    return jsonb_build_object('status','level_100_surplus_policy_pending');
  end if;

  -- A level can be regained after demotion, but the original first-time
  -- reward is never paid twice. Existing event_key UNIQUE is reused.
  for v_promoted in (v_state.current_level+1)..v_level loop
    v_point_id:=null;
    insert into public.scout_point_ledger(
      user_id,source_xp_id,point_kind,point_value,status,event_key,occurred_at,metadata
    ) values (
      v_xp.user_id,v_xp.id,'level_up',50,'confirmed',
      'level_up:'||v_xp.user_id::text||':'||v_promoted::text,
      v_xp.occurred_at,
      jsonb_build_object('level',v_promoted,'rule_version','formal-scout-level-100-owner-20261110')
    ) on conflict(event_key) do nothing returning id into v_point_id;
    if v_point_id is not null then
      perform novelight_formal_private.credit_confirmed_formal_point_draft(
        v_point_id,v_state.review_anchor_at
      );
    end if;
  end loop;
  insert into novelight_formal_private.scout_xp_claim(xp_id,user_id)
  values(p_xp_id,v_xp.user_id);
  update novelight_formal_private.scout_level_state set
    current_level=v_level,
    highest_level=greatest(highest_level,v_level),
    level_progress_xp=v_progress,
    revision=revision+1
  where user_id=v_xp.user_id;
  return jsonb_build_object('status','applied','level',v_level,'progress',v_progress);
end
$formal_progress$;

revoke all on function novelight_formal_private.apply_scout_xp(uuid)
  from public, anon, authenticated;
grant execute on function novelight_formal_private.apply_scout_xp(uuid)
  to service_role;

-- Replay postponed XP after reviewing completed 30-day windows in order.
-- Explicit service-side invocation only, no new Cron or automatic scheduler.
create or replace function novelight_formal_private.resume_pending_scout_xp(
  p_user_id uuid,p_as_of timestamptz,p_limit integer default 100
) returns jsonb
language plpgsql security definer set search_path = ''
as $resume_formal$
declare
  v_state novelight_formal_private.scout_level_state%rowtype;
  v_xp record;
  v_end timestamptz;
  v_review jsonb;
  v_apply jsonb;
  v_seen integer:=0;
  v_applied integer:=0;
  v_reviews integer:=0;
begin
  if p_user_id is null or p_as_of is null or p_as_of > clock_timestamp()
     or p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'Verified bounded replay request required';
  end if;
  select * into v_state from novelight_formal_private.scout_level_state
    where user_id=p_user_id for update;
  if not found then raise exception 'Formal state not initialized'; end if;
  for v_xp in
    select x.id,x.occurred_at from public.scout_xp_ledger x
    where x.user_id=p_user_id and x.occurred_at>=v_state.review_anchor_at
      and x.occurred_at<=p_as_of and not exists (
        select 1 from novelight_formal_private.scout_xp_claim cl where cl.xp_id=x.id
      )
    order by x.occurred_at,x.id limit p_limit
  loop
    v_seen:=v_seen+1;
    loop
      select * into v_state from novelight_formal_private.scout_level_state
        where user_id=p_user_id;
      v_end:=coalesce(v_state.last_review_end_at,v_state.review_anchor_at)
                 +interval '30 days';
      exit when v_xp.occurred_at < v_end;
      v_review:=novelight_formal_private.review_scout_30_days(p_user_id,p_as_of);
      if v_review->>'status'<>'reviewed' then
        return jsonb_build_object('status','review_hold','reason',v_review->>'status',
          'xp_applied',v_applied,'reviews',v_reviews);
      end if;
      v_reviews:=v_reviews+1;
      if v_reviews>=100 then
        return jsonb_build_object('status','review_limit','xp_applied',v_applied,'reviews',v_reviews);
      end if;
    end loop;
    v_apply:=novelight_formal_private.apply_scout_xp(v_xp.id);
    if v_apply->>'status'<>'applied' and v_apply->>'status'<>'already_applied' then
      return jsonb_build_object('status','xp_hold','reason',v_apply->>'status',
        'xp_applied',v_applied,'reviews',v_reviews);
    end if;
    v_applied:=v_applied+1;
  end loop;
  -- Never close a maintenance window while older unclaimed XP still awaits
  -- a subsequent bounded page. The next invocation resumes the same queue.
  if exists (
    select 1 from public.scout_xp_ledger x
    where x.user_id=p_user_id and x.occurred_at>=v_state.review_anchor_at
      and x.occurred_at<=p_as_of
      and not exists (
        select 1 from novelight_formal_private.scout_xp_claim cl where cl.xp_id=x.id
      )
  ) then
    return jsonb_build_object('status','more_pending','xp_applied',v_applied,
      'reviews',v_reviews,'candidates',v_seen);
  end if;
  -- Even if no XP arrived, all completed maintenance windows must be reviewed.
  loop
    select * into v_state from novelight_formal_private.scout_level_state
      where user_id=p_user_id;
    v_end:=coalesce(v_state.last_review_end_at,v_state.review_anchor_at)
                 +interval '30 days';
    exit when v_end > p_as_of;
    v_review:=novelight_formal_private.review_scout_30_days(p_user_id,p_as_of);
    if v_review->>'status'<>'reviewed' then
      return jsonb_build_object('status','review_hold','reason',v_review->>'status',
        'xp_applied',v_applied,'reviews',v_reviews);
    end if;
    v_reviews:=v_reviews+1;
    if v_reviews>=100 then
      return jsonb_build_object('status','review_limit','xp_applied',v_applied,'reviews',v_reviews);
    end if;
  end loop;
  return jsonb_build_object('status','caught_up','xp_applied',v_applied,
    'reviews',v_reviews,'candidates',v_seen);
end
$resume_formal$;

revoke all on function novelight_formal_private.resume_pending_scout_xp(uuid,timestamptz,integer)
  from public,anon,authenticated;
grant execute on function novelight_formal_private.resume_pending_scout_xp(uuid,timestamptz,integer)
  to service_role;

-- No new XP ledger, no duplicate XP source and no new scheduler.
-- Reuse the existing formal private apply_scout_xp() row lock and XP claim.
create or replace function novelight_formal_private.on_scout_xp_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $formal_capture$
declare
  v_result jsonb;
begin
  -- Historical accounts must be initialized first. An uninitialized new user
  -- retains the XP ledger entry for explicit catch-up; do not auto-assign a level.
  if not exists (
    select 1 from novelight_formal_private.scout_level_state s
    where s.user_id = new.user_id
  ) then
    return new;
  end if;
  v_result := novelight_formal_private.apply_scout_xp(new.id);
  -- review_due_first / closed_or_pre_release_window / Lv100 surplus remain
  -- unclaimed in scout_xp_ledger. The existing service can retry after
  -- completing chronological 30-day reviews. No implicit auto-review here.
  if v_result->>'status' not in (
    'applied',
    'already_applied',
    'review_due_first',
    'closed_or_pre_release_window',
    'level_100_surplus_policy_pending',
    'adjustment_policy_pending'
  ) then
    raise exception 'Unexpected formal XP application status: %',v_result->>'status';
  end if;
  return new;
end
$formal_capture$;

revoke all on function novelight_formal_private.on_scout_xp_insert()
  from public, anon, authenticated;
grant execute on function novelight_formal_private.on_scout_xp_insert()
  to service_role;

-- This trigger MUST be created only during the separately approved release
-- transaction: enabling it now would change the existing beta XP behavior.
create trigger scout_formal_xp_after_insert
after insert on public.scout_xp_ledger
for each row
execute function novelight_formal_private.on_scout_xp_insert();

-- Formal point rewards are issued atomically from the formal current Level state.\n-- This remains dormant; release sequencing and rollback require separate OWNER approval.
commit;
