-- NOVELIGHT AI Phase 02-07-04 review-only candidate schema.
-- This migration MUST NOT be applied to any database before its dedicated approval.
-- Service-role-only RPCs; the global AI switch and all AI budgets stay OFF/zero.
begin;

-- Fail closed if another writer already installed these RPCs or this table.
do $ai_review_migration_guard$
begin
  if pg_catalog.to_regclass('public.novelight_ai_review_candidates') is not null
    or pg_catalog.to_regprocedure('public.novelight_ai_review_stage_batch(uuid,bigint,bigint,text,text,jsonb)') is not null
    or pg_catalog.to_regprocedure('public.novelight_ai_review_decide(uuid,bigint,bigint,text,integer,text)') is not null then
    raise exception 'AI review migration blocked: candidate objects already exist';
  end if;
end;
$ai_review_migration_guard$;

create table public.novelight_ai_review_candidates (
  id bigint generated always as identity primary key,
  actor_id uuid not null,
  novel_id bigint not null references public.novels(id) on delete cascade,
  source_episode_id bigint not null references public.episodes(id) on delete cascade,
  source_hash text not null check (source_hash ~ '^[a-f0-9]{64}$'),
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  fact_kind text not null check (
    fact_kind in ('character','relationship','location','world',
      'timeline','event','foreshadowing','other')
  ),
  fact_key text not null check (char_length(fact_key) between 1 and 120),
  summary text not null check (char_length(summary) between 1 and 320),
  evidence text not null check (char_length(evidence) between 1 and 160),
  status text not null default 'pending'
    check (status in ('pending','accepted','rejected')),
  revision integer not null default 1 check (revision >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (actor_id, request_hash, fact_kind, fact_key)
);

create index novelight_ai_review_scope_idx
  on public.novelight_ai_review_candidates
  (actor_id, novel_id, status, id);

-- Required by FK delete checks; the actor-first scope index does not cover
-- either foreign key as the leading index column.
create index novelight_ai_review_novel_fk_idx
  on public.novelight_ai_review_candidates (novel_id);
create index novelight_ai_review_episode_fk_idx
  on public.novelight_ai_review_candidates (source_episode_id);

create or replace function public.novelight_ai_review_stage_batch(
  p_actor_id uuid,
  p_novel_id bigint,
  p_episode_id bigint,
  p_source_hash text,
  p_request_hash text,
  p_candidates jsonb
) returns integer
language plpgsql security invoker set search_path = '' as $$
declare
  v_candidate jsonb;
  v_count integer;
  v_title text;
  v_body text;
  v_current_hash text;
begin
  if current_user <> 'service_role' then
    raise exception using errcode = '42501', message = 'AI service access required';
  end if;
  if p_actor_id is null or p_novel_id is null or p_episode_id is null
    or p_source_hash is null or p_source_hash !~ '^[a-f0-9]{64}$'
    or p_request_hash is null or p_request_hash !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_candidates) is distinct from 'array'
  then
    raise exception using errcode = '22023', message = 'Invalid review batch';
  end if;
  v_count := jsonb_array_length(p_candidates);
  if v_count not between 1 and 12 then
    raise exception using errcode = '22023', message = 'Invalid review count';
  end if;
  -- Lock the actual current chapter through commit. A simultaneous title or
  -- body update waits until this batch has committed or rolled back.
  select e.title, e.content into v_title, v_body
  from public.episodes e
    join public.novels n on n.id = e.novel_id
  where e.id = p_episode_id
    and e.novel_id = p_novel_id
    and n.user_id = p_actor_id
  for share of e, n;
  if not found or v_title is null or v_body is null then
    raise exception using errcode = '42501', message = 'Review scope denied';
  end if;
  -- Node side uses sha256(JSON.stringify([title, content])).
  -- Staging must independently verify identical UTF-8 JSON serialization.
  v_current_hash := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(
      '[' || pg_catalog.to_json(v_title)::text || ',' ||
      pg_catalog.to_json(v_body)::text || ']', 'UTF8'
    ), 'sha256'), 'hex'
  );
  if v_current_hash is distinct from p_source_hash then
    raise exception using errcode = '22023', message = 'Stale episode source';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(p_actor_id::text),
    pg_catalog.hashtext(p_request_hash)
  );
  if exists (
    select 1 from public.novelight_ai_review_candidates c
    where c.actor_id = p_actor_id and c.request_hash = p_request_hash
  ) then
    return 0;
  end if;

  for v_candidate in select value from jsonb_array_elements(p_candidates)
  loop
    if jsonb_typeof(v_candidate) is distinct from 'object'
      or (select count(*) from jsonb_object_keys(v_candidate)) <> 4
      or jsonb_typeof(v_candidate -> 'kind') is distinct from 'string'
      or jsonb_typeof(v_candidate -> 'key') is distinct from 'string'
      or jsonb_typeof(v_candidate -> 'summary') is distinct from 'string'
      or jsonb_typeof(v_candidate -> 'evidence') is distinct from 'string'
      or v_candidate ->> 'kind' not in
        ('character','relationship','location','world',
         'timeline','event','foreshadowing','other')
      or char_length(v_candidate ->> 'key') not between 1 and 120
      or char_length(v_candidate ->> 'summary') not between 1 and 320
      or char_length(v_candidate ->> 'evidence') not between 1 and 160
      or pg_catalog.btrim(v_candidate ->> 'key') = ''
      or pg_catalog.btrim(v_candidate ->> 'summary') = ''
      or pg_catalog.btrim(v_candidate ->> 'evidence') = ''
      -- Defense in depth: the original manuscript must contain the exact
      -- evidence, even if a future internal caller skips the Node validator.
      or pg_catalog.strpos(v_body, v_candidate ->> 'evidence') = 0
    then
      raise exception using errcode = '22023', message = 'Invalid review candidate';
    end if;
    insert into public.novelight_ai_review_candidates (
      actor_id, novel_id, source_episode_id, source_hash, request_hash,
      fact_kind, fact_key, summary, evidence
    ) values (
      p_actor_id, p_novel_id, p_episode_id, p_source_hash, p_request_hash,
      v_candidate ->> 'kind', v_candidate ->> 'key',
      v_candidate ->> 'summary', v_candidate ->> 'evidence'
    );
  end loop;
  return v_count;
end
$$;

create or replace function public.novelight_ai_review_decide(
  p_actor_id uuid,
  p_novel_id bigint,
  p_candidate_id bigint,
  p_source_hash text,
  p_expected_revision integer,
  p_decision text
) returns table(status text, revision integer)
language plpgsql security invoker set search_path = '' as $$
declare
  v_title text;
  v_body text;
  v_current_hash text;
begin
  if current_user <> 'service_role' then
    raise exception using errcode = '42501', message = 'AI service access required';
  end if;
  if p_actor_id is null or p_novel_id is null or p_candidate_id is null
    or p_source_hash is null or p_source_hash !~ '^[a-f0-9]{64}$'
    or p_expected_revision is null or p_expected_revision < 1
    or p_decision is null or p_decision not in ('accepted', 'rejected')
  then
    raise exception using errcode = '22023', message = 'Invalid review decision';
  end if;
  -- Re-read and lock the authoritative chapter before changing any decision.
  -- The candidate's stored hash alone does not prove the current manuscript
  -- still matches. The final UPDATE remains an atomic revision/status CAS.
  select e.title, e.content into v_title, v_body
  from public.novelight_ai_review_candidates c
    join public.episodes e on e.id = c.source_episode_id
    join public.novels n on n.id = c.novel_id
  where c.id = p_candidate_id
    and c.actor_id = p_actor_id
    and c.novel_id = p_novel_id
    and c.source_hash = p_source_hash
    and c.revision = p_expected_revision
    and c.status = 'pending'
    and e.novel_id = c.novel_id
    and n.user_id = p_actor_id
  for share of e, n;
  if not found or v_title is null or v_body is null then
    raise exception using errcode = '42501', message = 'Review scope denied';
  end if;
  v_current_hash := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(
      '[' || pg_catalog.to_json(v_title)::text || ',' ||
      pg_catalog.to_json(v_body)::text || ']', 'UTF8'
    ), 'sha256'), 'hex'
  );
  if v_current_hash is distinct from p_source_hash then
    raise exception using errcode = '22023', message = 'Stale episode source';
  end if;

  return query
    update public.novelight_ai_review_candidates as c
      set status = p_decision,
          revision = c.revision + 1,
          updated_at = now()
    where c.id = p_candidate_id
      and c.actor_id = p_actor_id
      and c.novel_id = p_novel_id
      and c.source_hash = p_source_hash
      and c.revision = p_expected_revision
      and c.status = 'pending'
      and exists (
        select 1 from public.novels n
        where n.id = c.novel_id and n.user_id = p_actor_id
      )
    returning c.status, c.revision;
end
$$;

alter table public.novelight_ai_review_candidates enable row level security;
create policy ai_review_service_only
  on public.novelight_ai_review_candidates
  for all to service_role using (true) with check (true);

revoke all on public.novelight_ai_review_candidates
  from public, anon, authenticated;
revoke all on sequence public.novelight_ai_review_candidates_id_seq
  from public, anon, authenticated;
grant select, insert, update on public.novelight_ai_review_candidates
  to service_role;
grant usage, select on sequence public.novelight_ai_review_candidates_id_seq
  to service_role;

revoke all on function public.novelight_ai_review_stage_batch(
  uuid, bigint, bigint, text, text, jsonb
) from public, anon, authenticated;
revoke all on function public.novelight_ai_review_decide(
  uuid, bigint, bigint, text, integer, text
) from public, anon, authenticated;
grant execute on function public.novelight_ai_review_stage_batch(
  uuid, bigint, bigint, text, text, jsonb
) to service_role;
grant execute on function public.novelight_ai_review_decide(
  uuid, bigint, bigint, text, integer, text
) to service_role;

comment on table public.novelight_ai_review_candidates is
  'Private author-only review decisions. Accepted does NOT mean confirmed canon.';

commit;
