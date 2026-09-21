-- NOVELIGHT SCOUT RECORD usage KPI and basic Point anti-abuse controls.
-- Extends the existing beta core without replacing XP, Level, discovery, Point
-- or Badge ledgers.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260921025328'));

do $$
begin
  if to_regclass('public.scout_point_ledger') is null
     or to_regclass('public.scout_badge_definitions') is null
     or to_regclass('public.user_lifecycle') is null then
    raise exception 'SCOUT core, badge foundation, and beta lifecycle are required';
  end if;

  if to_regclass('public.scout_record_usage_days') is not null
     or to_regclass('public.scout_point_user_controls') is not null
     or to_regclass('public.scout_point_operator_actions') is not null then
    raise exception 'SCOUT usage/control foundation already exists or requires reconciliation';
  end if;
end
$$;

create table public.scout_record_usage_days (
  user_id uuid not null,
  activity_date date not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  visit_count integer not null default 1 check (visit_count > 0),
  primary key (user_id, activity_date)
);

create index scout_record_usage_recent_idx
  on public.scout_record_usage_days (activity_date desc, user_id);

create table public.scout_point_user_controls (
  user_id uuid primary key,
  earning_suspended_until timestamptz,
  reason text not null default '',
  updated_by uuid,
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint scout_point_control_reason_length check (char_length(reason) <= 1000)
);

create table public.scout_point_operator_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  ledger_id uuid references public.scout_point_ledger(id) on delete restrict,
  action text not null
    check (action in (
      'freeze',
      'confirm',
      'cancel',
      'suspend_points',
      'resume_points',
      'adjust'
    )),
  actor_user_id uuid not null,
  reason text not null,
  effective_until timestamptz,
  amount integer,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint scout_operator_reason_length check (char_length(reason) between 3 and 1000),
  constraint scout_operator_amount_bounds check (
    amount is null or amount between -100000 and 100000
  )
);

create index scout_point_operator_user_recent_idx
  on public.scout_point_operator_actions (user_id, created_at desc);

alter table public.scout_record_usage_days enable row level security;
alter table public.scout_point_user_controls enable row level security;
alter table public.scout_point_operator_actions enable row level security;

revoke all on table public.scout_record_usage_days from public, anon, authenticated;
revoke all on table public.scout_point_user_controls from public, anon, authenticated;
revoke all on table public.scout_point_operator_actions from public, anon, authenticated;

create or replace function public.novelight_record_scout_record_visit()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_date date := pg_catalog.timezone('Asia/Tokyo', pg_catalog.now())::date;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  insert into public.scout_record_usage_days (
    user_id, activity_date, first_seen_at, last_seen_at, visit_count
  ) values (
    v_uid, v_date, pg_catalog.now(), pg_catalog.now(), 1
  )
  on conflict (user_id, activity_date) do update
    set last_seen_at = excluded.last_seen_at,
        visit_count = public.scout_record_usage_days.visit_count + 1;

  return true;
end
$$;

revoke all on function public.novelight_record_scout_record_visit()
  from public, anon;
grant execute on function public.novelight_record_scout_record_visit()
  to authenticated;

create or replace function public.novelight_scout_point_earning_allowed(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1
    from public.scout_point_user_controls c
    where c.user_id = p_user_id
      and c.earning_suspended_until is not null
      and c.earning_suspended_until > pg_catalog.now()
  )
$$;

revoke all on function public.novelight_scout_point_earning_allowed(uuid)
  from public, anon, authenticated;

create or replace function public.novelight_enforce_scout_point_control()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.point_value <= 0
     or new.point_kind in ('reversal', 'manual_adjustment') then
    return new;
  end if;

  if not public.novelight_scout_point_earning_allowed(new.user_id) then
    return null;
  end if;

  return new;
end
$$;

revoke all on function public.novelight_enforce_scout_point_control()
  from public, anon, authenticated;

create trigger scout_point_earning_control
before insert on public.scout_point_ledger
for each row execute function public.novelight_enforce_scout_point_control();

create or replace function public.novelight_admin_scout_point_action(
  p_user_id uuid,
  p_action text,
  p_reason text,
  p_actor_user_id uuid,
  p_ledger_id uuid default null,
  p_until timestamptz default null,
  p_amount integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_reason text := btrim(coalesce(p_reason, ''));
  v_ledger public.scout_point_ledger%rowtype;
  v_action_id uuid := gen_random_uuid();
  v_result_ledger_id uuid;
begin
  if p_user_id is null or p_actor_user_id is null then
    raise exception using errcode = '22023', message = 'User and actor are required';
  end if;

  if char_length(v_reason) not between 3 and 1000 then
    raise exception using errcode = '22023', message = 'Reason must be 3-1000 characters';
  end if;

  if v_action not in (
    'freeze',
    'confirm',
    'cancel',
    'suspend_points',
    'resume_points',
    'adjust'
  ) then
    raise exception using errcode = '22023', message = 'Unsupported SCOUT Point action';
  end if;

  if v_action in ('freeze', 'confirm', 'cancel') then
    if p_ledger_id is null then
      raise exception using errcode = '22023', message = 'Ledger id is required';
    end if;

    select * into v_ledger
    from public.scout_point_ledger p
    where p.id = p_ledger_id
      and p.user_id = p_user_id
    for update;

    if not found then
      raise exception using errcode = 'P0002', message = 'Scout Point ledger row not found';
    end if;
  end if;

  if v_action = 'freeze' then
    if v_ledger.point_value <= 0
       or v_ledger.status not in ('confirmed', 'pending') then
      raise exception using errcode = '22023', message = 'Only active positive rewards can be frozen';
    end if;

    update public.scout_point_ledger
       set status = 'frozen'
     where id = v_ledger.id;

  elsif v_action = 'confirm' then
    if v_ledger.status not in ('pending', 'frozen') then
      raise exception using errcode = '22023', message = 'Only pending or frozen rewards can be confirmed';
    end if;

    update public.scout_point_ledger
       set status = 'confirmed'
     where id = v_ledger.id;

  elsif v_action = 'cancel' then
    if v_ledger.point_value <= 0 or v_ledger.reversal_of is not null then
      raise exception using errcode = '22023', message = 'Only positive reward rows can be cancelled';
    end if;

    if exists (
      select 1
      from public.scout_point_ledger p
      where p.reversal_of = v_ledger.id
        and p.point_kind = 'reversal'
    ) then
      raise exception using errcode = '23505', message = 'Reward already has a reversal';
    end if;

    if v_ledger.status = 'confirmed' then
      insert into public.scout_point_ledger (
        user_id,
        point_kind,
        point_value,
        status,
        event_key,
        reversal_of,
        occurred_at,
        metadata
      ) values (
        p_user_id,
        'reversal',
        -v_ledger.point_value,
        'confirmed',
        'admin_reversal:' || v_ledger.id::text,
        v_ledger.id,
        pg_catalog.now(),
        pg_catalog.jsonb_build_object(
          'reason', v_reason,
          'actor_user_id', p_actor_user_id,
          'original_point_kind', v_ledger.point_kind,
          'rule_version', 'chapter49-control-v1'
        )
      )
      returning id into v_result_ledger_id;
    elsif v_ledger.status in ('pending', 'frozen') then
      update public.scout_point_ledger
         set status = 'cancelled'
       where id = v_ledger.id;
    else
      raise exception using errcode = '22023', message = 'Reward is already cancelled';
    end if;

  elsif v_action = 'suspend_points' then
    if p_until is null or p_until <= pg_catalog.now() then
      raise exception using errcode = '22023', message = 'Future suspension end is required';
    end if;

    insert into public.scout_point_user_controls (
      user_id, earning_suspended_until, reason, updated_by, updated_at
    ) values (
      p_user_id, p_until, v_reason, p_actor_user_id, pg_catalog.now()
    )
    on conflict (user_id) do update
      set earning_suspended_until = excluded.earning_suspended_until,
          reason = excluded.reason,
          updated_by = excluded.updated_by,
          updated_at = excluded.updated_at;

  elsif v_action = 'resume_points' then
    insert into public.scout_point_user_controls (
      user_id, earning_suspended_until, reason, updated_by, updated_at
    ) values (
      p_user_id, null, v_reason, p_actor_user_id, pg_catalog.now()
    )
    on conflict (user_id) do update
      set earning_suspended_until = null,
          reason = excluded.reason,
          updated_by = excluded.updated_by,
          updated_at = excluded.updated_at;

  elsif v_action = 'adjust' then
    if p_amount is null or p_amount = 0 or abs(p_amount) > 100000 then
      raise exception using errcode = '22023', message = 'Non-zero bounded adjustment amount is required';
    end if;

    insert into public.scout_point_ledger (
      user_id,
      point_kind,
      point_value,
      status,
      event_key,
      occurred_at,
      metadata
    ) values (
      p_user_id,
      'manual_adjustment',
      p_amount,
      'confirmed',
      'admin_adjust:' || v_action_id::text,
      pg_catalog.now(),
      pg_catalog.jsonb_build_object(
        'reason', v_reason,
        'actor_user_id', p_actor_user_id,
        'rule_version', 'chapter49-control-v1'
      )
    )
    returning id into v_result_ledger_id;
  end if;

  insert into public.scout_point_operator_actions (
    id,
    user_id,
    ledger_id,
    action,
    actor_user_id,
    reason,
    effective_until,
    amount,
    metadata
  ) values (
    v_action_id,
    p_user_id,
    coalesce(v_result_ledger_id, p_ledger_id),
    v_action,
    p_actor_user_id,
    v_reason,
    p_until,
    p_amount,
    pg_catalog.jsonb_build_object('rule_version', 'chapter49-control-v1')
  );

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'action', v_action,
    'user_id', p_user_id,
    'ledger_id', coalesce(v_result_ledger_id, p_ledger_id)
  );
end
$$;

revoke all on function public.novelight_admin_scout_point_action(
  uuid, text, text, uuid, uuid, timestamptz, integer
) from public, anon, authenticated;
grant execute on function public.novelight_admin_scout_point_action(
  uuid, text, text, uuid, uuid, timestamptz, integer
) to service_role;

comment on table public.scout_record_usage_days is
  'Private owner-day SCOUT RECORD usage ledger for exact beta usage and retention cohort measurement.';
comment on table public.scout_point_user_controls is
  'Private Point earning suspension state. Positive automatic Scout Point inserts are centrally blocked while active.';
comment on table public.scout_point_operator_actions is
  'Immutable operator audit trail for Scout Point freeze, confirm, cancellation, suspension, resume and manual adjustment.';

commit;
