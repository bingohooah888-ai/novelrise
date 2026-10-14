-- Step 05 / November contest. READ-ONLY prelaunch state contract.
-- Call this before requesting a separate 受付開始承認.
-- It cannot approve terms, change any contest state, or start registration.
\set ON_ERROR_STOP on
begin transaction read only;
do $novelight_registration_audit$
declare
  v_contest public.novelight_contests%rowtype;
  v_entries bigint;
  v_catalog jsonb;
begin
  select * into strict v_contest
    from public.novelight_contests
   where contest_key = 'novelight-november-2026';

  if v_contest.status <> 'draft' or v_contest.public_visible is not false then
    raise exception 'STEP05_PRELAUNCH_BLOCKED: contest is not private draft';
  end if;
  if v_contest.terms_version <> '' or v_contest.terms_url <> '' then
    raise exception 'STEP05_PRELAUNCH_BLOCKED: terms already configured; manual review required';
  end if;
  if v_contest.entry_deadline_at is distinct from '2026-10-31 14:59:59.999999+00'::timestamptz
     or v_contest.starts_at is distinct from '2026-10-31 15:00:00+00'::timestamptz
     or v_contest.ends_at is distinct from '2026-11-30 15:00:00+00'::timestamptz
     or pg_catalog.clock_timestamp() >= v_contest.entry_deadline_at then
    raise exception 'STEP05_PRELAUNCH_BLOCKED: window invalid or expired';
  end if;

  select count(*) into v_entries
    from public.novelight_contest_entries
   where contest_id = v_contest.id;
  if v_entries <> 0 then
    raise exception 'STEP05_PRELAUNCH_BLOCKED: existing entries require operator review';
  end if;

  if pg_catalog.has_function_privilege(
       'anon','public.novelight_contest_entry_action_v2(text,bigint,text,text)','EXECUTE')
     or not pg_catalog.has_function_privilege(
       'authenticated','public.novelight_contest_entry_action_v2(text,bigint,text,text)','EXECUTE')
  then
    raise exception 'STEP05_PRELAUNCH_BLOCKED: author entry role grants differ';
  end if;

  select public.novelight_public_contest_catalog(1,0) into v_catalog;
  if v_catalog ->> 'reason' is distinct from 'contest_unavailable'
     or (v_catalog ->> 'ok')::boolean is distinct from false then
    raise exception 'STEP05_PRELAUNCH_BLOCKED: catalog is unexpectedly available';
  end if;

  raise notice 'STEP05_PRIVATE_PREFLIGHT_PASS: NO authorization to publish';
end
$novelight_registration_audit$;
rollback;
