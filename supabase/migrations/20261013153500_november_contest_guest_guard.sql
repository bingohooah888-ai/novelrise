-- Stage 06 guest credential issuance guard. No live activation or data copy.
-- Only a trusted backend can consume an issuance slot. No raw IP is stored.
begin;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtext('novelight:20261013153500:guest-guard')
);

create table public.novelight_contest_guest_creation_guard (
  fingerprint text primary key
    check (fingerprint ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null,
  attempts integer not null default 1
    check (attempts between 1 and 5),
  updated_at timestamptz not null default pg_catalog.clock_timestamp()
);

alter table public.novelight_contest_guest_creation_guard
  enable row level security;
revoke all on public.novelight_contest_guest_creation_guard
  from public, anon, authenticated;
grant all on public.novelight_contest_guest_creation_guard
  to service_role;

create or replace function public.novelight_contest_guest_creation_slot(
  p_fingerprint text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $guard$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_accepted integer := 0;
begin
  if p_fingerprint is null
     or p_fingerprint !~ '^[0-9a-f]{64}$' then
    return false;
  end if;

  insert into public.novelight_contest_guest_creation_guard as g (
    fingerprint, window_started_at, attempts, updated_at
  ) values (
    p_fingerprint, v_now, 1, v_now
  )
  on conflict (fingerprint) do update
    set window_started_at = case
          when g.window_started_at <= v_now - interval '24 hours'
            then v_now else g.window_started_at end,
        attempts = case
          when g.window_started_at <= v_now - interval '24 hours'
            then 1 else g.attempts + 1 end,
        updated_at = v_now
    where g.window_started_at <= v_now - interval '24 hours'
       or g.attempts < 5;
  get diagnostics v_accepted = row_count;
  return v_accepted = 1;
end
$guard$;

revoke all on function public.novelight_contest_guest_creation_slot(text)
  from public, anon, authenticated;
grant execute on function public.novelight_contest_guest_creation_slot(text)
  to service_role;

commit;
