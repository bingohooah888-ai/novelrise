-- NOVELIGHT formal-only Scout state, DRAFT / NOT A MIGRATION.
-- Intentionally stored under docs/drafts: never applied by Supabase db push.
-- Requires explicit, separate release approval and isolated Staging DB proof.
-- Existing beta tables, triggers, RPCs and balances remain untouched.

create schema if not exists novelight_formal_private;
revoke all on schema novelight_formal_private from public, anon, authenticated;
grant usage on schema novelight_formal_private to service_role;

create table novelight_formal_private.scout_level_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  current_level smallint not null check (current_level between 1 and 100),
  highest_level smallint not null check (highest_level between 1 and 100),
  level_progress_xp integer not null check (level_progress_xp >= 0),
  review_anchor_at timestamptz not null,
  last_review_end_at timestamptz,
  revision bigint not null default 0 check (revision >= 0),
  check (highest_level >= current_level),
  check (highest_level < 70 or current_level >= 50),
  check (last_review_end_at is null or last_review_end_at >= review_anchor_at)
);
create table novelight_formal_private.scout_xp_claim (
  xp_id uuid primary key references public.scout_xp_ledger(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete cascade,
  applied_at timestamptz not null default now()
);
create index scout_formal_xp_claim_user_idx on novelight_formal_private.scout_xp_claim(user_id);
create table novelight_formal_private.scout_review_claim (
  user_id uuid not null references auth.users(id) on delete cascade,
  window_end_at timestamptz not null,
  awarded_xp integer not null check (awarded_xp >= 0),
  before_level smallint not null,
  after_level smallint not null,
  created_at timestamptz not null default now(),
  primary key (user_id, window_end_at)
);
alter table novelight_formal_private.scout_level_state enable row level security;
alter table novelight_formal_private.scout_xp_claim enable row level security;
alter table novelight_formal_private.scout_review_claim enable row level security;
revoke all on all tables in schema novelight_formal_private from public, anon, authenticated;
-- No grants to client roles; server function is the only write path.

create or replace function novelight_formal_private.initialize_beta_level(
  p_user_id uuid,
  p_release_at timestamptz
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_created_at timestamptz;
  v_beta_xp bigint;
  v_level smallint;
  v_floor integer;
  v_next integer;
  v_row novelight_formal_private.scout_level_state%rowtype;
begin
  if p_user_id is null or p_release_at is null then
    raise exception 'verified account and release timestamp required';
  end if;
  select created_at into v_created_at from auth.users where id = p_user_id;
  if v_created_at is null or v_created_at >= p_release_at then
    raise exception 'not an eligible pre-release beta account';
  end if;
  -- Keep beta discovery exclusion; do not promote forfeited/capped historic XP.
  select least(9570::bigint, greatest(0::bigint, coalesce(sum(x.xp_value),0)))
    into v_beta_xp from public.scout_xp_ledger x
   where x.user_id = p_user_id and x.xp_kind <> 'light_seed_discovery';
  select t.level, t.cumulative_xp into v_level,v_floor
    from public.scout_level_thresholds t
   where t.level <= 30 and t.cumulative_xp <= v_beta_xp
   order by t.level desc limit 1;
  if v_level is null then raise exception 'beta thresholds unavailable'; end if;
  if v_level < 30 then
    select cumulative_xp into v_next from public.scout_level_thresholds
     where level = v_level + 1;
    if v_next is null or v_next <= v_beta_xp then
      raise exception 'beta threshold inconsistency';
    end if;
  end if;
  insert into novelight_formal_private.scout_level_state (
    user_id,current_level,highest_level,level_progress_xp,review_anchor_at
  ) values (
    p_user_id,v_level,v_level,(v_beta_xp-v_floor)::integer,p_release_at
  ) on conflict (user_id) do nothing;
  select * into v_row from novelight_formal_private.scout_level_state
   where user_id=p_user_id;
  return jsonb_build_object('status','initialized_or_existing','level',v_row.current_level,
    'progress',v_row.level_progress_xp,'revision',v_row.revision);
end $$;

create or replace function novelight_formal_private.apply_scout_xp(
  p_xp_id uuid
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_xp public.scout_xp_ledger%rowtype;
  v_state novelight_formal_private.scout_level_state%rowtype;
  v_progress integer;
  v_level smallint;
  v_required integer;
begin
  select * into v_xp from public.scout_xp_ledger where id=p_xp_id;
  if not found then raise exception 'source XP row not found'; end if;
  -- All formal state changes for a reader are serialized on the same row.
  select * into v_state from novelight_formal_private.scout_level_state
   where user_id=v_xp.user_id for update;
  if not found then raise exception 'formal state not initialized'; end if;
  if exists(select 1 from novelight_formal_private.scout_xp_claim where xp_id=p_xp_id) then
    return jsonb_build_object('status','already_applied');
  end if;
  if v_xp.xp_value <= 0 then
    return jsonb_build_object('status','adjustment_policy_pending');
  end if;
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
      select next_t.cumulative_xp - current_t.cumulative_xp into v_required
        from public.scout_level_thresholds current_t
        join public.scout_level_thresholds next_t on next_t.level=current_t.level+1
       where current_t.level=v_level;
    else
      v_required := 400;
    end if;
    if v_required is null or v_required <= 0 then
      raise exception 'formal threshold unavailable';
    end if;
    if v_progress < v_required then exit; end if;
    v_progress := v_progress - v_required;
    v_level := v_level+1;
  end loop;
  if v_level=100 and v_progress>0 then
    return jsonb_build_object('status','level_100_surplus_policy_pending');
  end if;
  insert into novelight_formal_private.scout_xp_claim(xp_id,user_id)
    values(p_xp_id,v_xp.user_id);
  update novelight_formal_private.scout_level_state set
    current_level=v_level,
    highest_level=greatest(highest_level,v_level),
    level_progress_xp=v_progress,
    revision=revision+1
  where user_id=v_xp.user_id;
  return jsonb_build_object('status','applied','level',v_level,'progress',v_progress);
end $$;

create or replace function novelight_formal_private.review_scout_30_days(
  p_user_id uuid,
  p_as_of timestamptz
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_state novelight_formal_private.scout_level_state%rowtype;
  v_start timestamptz;
  v_end timestamptz;
  v_xp bigint;
  v_negative boolean;
  v_next smallint;
begin
  select * into v_state from novelight_formal_private.scout_level_state
   where user_id=p_user_id for update;
  if not found then raise exception 'formal state missing'; end if;
  v_start := coalesce(v_state.last_review_end_at,v_state.review_anchor_at);
  v_end := v_start+interval '30 days';
  if p_as_of is null or p_as_of > clock_timestamp() then
    raise exception 'review time must be a verified past or current instant';
  end if;
  if p_as_of < v_end then
    return jsonb_build_object('status','not_due');
  end if;
  if exists(select 1 from novelight_formal_private.scout_review_claim
            where user_id=p_user_id and window_end_at=v_end) then
    return jsonb_build_object('status','already_reviewed');
  end if;
  -- Count every confirmed XP kind INCLUDING light_seed_discovery.
  -- Never use the beta public summary RPC for formal maintenance.
  select coalesce(sum(greatest(0,x.xp_value)),0),
         coalesce(bool_or(x.xp_value<0),false)
    into v_xp,v_negative from public.scout_xp_ledger x
   where x.user_id=p_user_id and x.occurred_at>=v_start and x.occurred_at<v_end;
  if v_negative then return jsonb_build_object('status','adjustment_policy_pending'); end if;
  if v_xp > 2147483647 then raise exception 'review XP exceeds integer storage'; end if;
  v_next := case when v_xp>=200 then v_state.current_level
      else greatest(case when v_state.highest_level>=70 then 50 else 1 end,
                    v_state.current_level-1) end;
  insert into novelight_formal_private.scout_review_claim (
    user_id,window_end_at,awarded_xp,before_level,after_level
  ) values (p_user_id,v_end,v_xp::integer,v_state.current_level,v_next);
  update novelight_formal_private.scout_level_state set
    current_level=v_next,
    level_progress_xp=case when v_next<v_state.current_level then 0 else level_progress_xp end,
    last_review_end_at=v_end,
    revision=revision+1
   where user_id=p_user_id;
  return jsonb_build_object('status','reviewed','level',v_next,'earned_xp',v_xp,
     'demoted',v_next<v_state.current_level,'window_end',v_end);
end $$;

revoke all on function novelight_formal_private.initialize_beta_level(uuid,timestamptz)
  from public,anon,authenticated;
revoke all on function novelight_formal_private.apply_scout_xp(uuid)
  from public,anon,authenticated;
revoke all on function novelight_formal_private.review_scout_30_days(uuid,timestamptz)
  from public,anon,authenticated;
grant execute on function novelight_formal_private.initialize_beta_level(uuid,timestamptz)
  to service_role;
grant execute on function novelight_formal_private.apply_scout_xp(uuid)
  to service_role;
grant execute on function novelight_formal_private.review_scout_30_days(uuid,timestamptz)
  to service_role;
