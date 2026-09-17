-- Competitor audit #1: author-owned work export authorization, rate limiting, and audit logging.
-- This migration is intentionally NOT applied to Production by this PR.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260917123000-author-work-export'));

do $$
begin
  if to_regclass('public.novels') is null or to_regclass('public.episodes') is null then
    raise exception 'Required novels/episodes tables are missing';
  end if;

  if to_regclass('public.author_work_export_audit') is not null then
    raise exception 'public.author_work_export_audit already exists; stop and inspect before applying';
  end if;

  if to_regprocedure('public.novelight_authorize_work_export(bigint,text)') is not null then
    raise exception 'novelight_authorize_work_export already exists; stop and inspect before applying';
  end if;
end
$$;

create table public.author_work_export_audit (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  novel_id bigint not null references public.novels(id) on delete cascade,
  format text not null default 'txt' check (format = 'txt'),
  requested_at timestamptz not null default now()
);

create index author_work_export_audit_user_requested_idx
  on public.author_work_export_audit (user_id, requested_at desc);

create index author_work_export_audit_novel_requested_idx
  on public.author_work_export_audit (novel_id, requested_at desc);

alter table public.author_work_export_audit enable row level security;

-- Audit rows are intentionally private. Authors can request an export through
-- the owner-checking RPC below, but no client role can inspect the audit log.
revoke all on table public.author_work_export_audit from public;
revoke all on table public.author_work_export_audit from anon;
revoke all on table public.author_work_export_audit from authenticated;

create function public.novelight_authorize_work_export(
  p_novel_id bigint,
  p_format text default 'txt'
)
returns table (
  audit_id uuid,
  requested_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid uuid := auth.uid();
  v_format text := lower(trim(coalesce(p_format, '')));
  v_now timestamptz := clock_timestamp();
  v_audit_id uuid;
begin
  if v_uid is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  if p_novel_id is null or p_novel_id <= 0 then
    raise exception 'invalid_export_request' using errcode = '22023';
  end if;

  if v_format <> 'txt' then
    raise exception 'unsupported_export_format' using errcode = '22023';
  end if;

  -- Serialize rate-limit decisions per author so concurrent requests cannot
  -- race through the audit-backed limits.
  perform pg_advisory_xact_lock(hashtext('novelight:author-work-export:' || v_uid::text));

  if not exists (
    select 1
      from public.novels n
     where n.id = p_novel_id
       and n.user_id = v_uid
  ) then
    raise exception 'export_not_found' using errcode = 'P0002';
  end if;

  -- Beta safety limits. These protect accidental loops and scripted scraping
  -- without preventing ordinary author backups.
  if (
    select count(*)
      from public.author_work_export_audit a
     where a.user_id = v_uid
       and a.requested_at >= v_now - interval '10 minutes'
  ) >= 10 then
    raise exception 'author_export_rate_limited' using errcode = 'P0001';
  end if;

  if (
    select count(*)
      from public.author_work_export_audit a
     where a.user_id = v_uid
       and a.requested_at >= v_now - interval '24 hours'
  ) >= 50 then
    raise exception 'author_export_rate_limited' using errcode = 'P0001';
  end if;

  insert into public.author_work_export_audit (
    user_id,
    novel_id,
    format,
    requested_at
  ) values (
    v_uid,
    p_novel_id,
    v_format,
    v_now
  )
  returning id into v_audit_id;

  return query
  select v_audit_id, v_now;
end
$$;

revoke all on function public.novelight_authorize_work_export(bigint, text) from public;
revoke all on function public.novelight_authorize_work_export(bigint, text) from anon;
revoke all on function public.novelight_authorize_work_export(bigint, text) from authenticated;
grant execute on function public.novelight_authorize_work_export(bigint, text) to authenticated;

comment on table public.author_work_export_audit is
  'Private audit trail for author work export requests. Client roles have no direct access.';
comment on function public.novelight_authorize_work_export(bigint, text) is
  'Authenticated author work export authorization with auth.uid owner verification, concurrency-safe rate limiting, and private audit logging.';

commit;
