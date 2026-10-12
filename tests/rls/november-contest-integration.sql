\set ON_ERROR_STOP on

-- CI-only integration: executes against the disposable PostgreSQL migration
-- replay database, NEVER the live Supabase project. All fixture writes roll back.
begin;

do $$
begin
  if to_regclass('public.novelight_contests') is null
    or to_regprocedure(
      'public.novelight_contest_entry_action(text,bigint,text)'
    ) is null
    or to_regprocedure(
      'public.novelight_public_contest_catalog(integer,integer)'
    ) is null then
    raise exception 'Contest DB migration replay incomplete';
  end if;

  if exists (
    select 1 from public.novelight_contests
    where contest_key = 'novelight-november-2026'
      and (public_visible is distinct from false or status <> 'draft')
  ) then
    raise exception 'Contest is not draft/hidden after migrations';
  end if;
end
$$;

-- The existing replay schema uses the production-like BIGINT work IDs.
insert into auth.users (id, raw_user_meta_data) values
  (
    'caf00000-0000-4000-8000-000000000001',
    '{"display_name":"Contest CI A"}'::jsonb
  ),
  (
    'caf00000-0000-4000-8000-000000000002',
    '{"display_name":"Contest CI B"}'::jsonb
  );

insert into public.novel_thumbnail_assets (
  id, label, storage_path, image_url, is_active
) values (
  'caf00000-0000-4000-8000-000000000003',
  'Contest disposable fixture',
  'official/contest-ci-safe.webp',
  'https://example.com/contest-ci-safe.webp',
  true
);

insert into public.novels (
  user_id, title, description, genre, status, created_at,
  ai_usage, content_policy_ack, content_policy_version, thumbnail_asset_id
) values
  (
    'caf00000-0000-4000-8000-000000000001',
    'CONTEST_CI_ELIGIBLE_A',
    'Contest read-only fixture A',
    '現代ファンタジー',
    'published', '2026-09-20T00:00:00Z',
    'human', true, 'beta-2026-08-23',
    'caf00000-0000-4000-8000-000000000003'
  ),
  (
    'caf00000-0000-4000-8000-000000000001',
    'CONTEST_CI_NINE_A',
    'Contest read-only fixture 9 chapters',
    '現代ファンタジー',
    'published', '2026-09-20T00:00:00Z',
    'human', true, 'beta-2026-08-23',
    'caf00000-0000-4000-8000-000000000003'
  ),
  (
    'caf00000-0000-4000-8000-000000000002',
    'CONTEST_CI_ELIGIBLE_B',
    'Contest read-only fixture B',
    '現代ファンタジー',
    'published', '2026-09-20T00:00:00Z',
    'human', true, 'beta-2026-08-23',
    'caf00000-0000-4000-8000-000000000003'
  );

insert into public.episodes (
  novel_id, user_id, episode_number, title, content, status, pv
)
select n.id, n.user_id, gs.n, 'Contest CI episode ' || gs.n,
       repeat('Contest fixture text. ', 24), 'published', 0
from public.novels n
cross join lateral generate_series(
  1, case when n.title = 'CONTEST_CI_NINE_A' then 9 else 10 end
) as gs(n)
where n.title in (
  'CONTEST_CI_ELIGIBLE_A',
  'CONTEST_CI_NINE_A',
  'CONTEST_CI_ELIGIBLE_B'
);

-- Reading private tables is prohibited to both public-facing roles.
do $$
begin
  if has_table_privilege('anon', 'public.novelight_contest_entries', 'select')
    or has_table_privilege(
      'authenticated', 'public.novelight_contest_entries', 'select'
    ) then
    raise exception 'Contest private entry table was exposed';
  end if;
  if has_function_privilege(
    'anon', 'public.novelight_contest_entry_action(text,bigint,text)', 'execute'
  ) then
    raise exception 'Guest was granted author entry mutation RPC';
  end if;
  if not has_function_privilege(
    'anon', 'public.novelight_public_contest_catalog(integer,integer)',
    'execute'
  ) then
    raise exception 'Public reader work catalog is unavailable';
  end if;
end
$$;

set local role anon;
do $$
declare v_data jsonb;
begin
  select public.novelight_public_contest_catalog(24, 0) into v_data;
  if v_data->>'reason' <> 'contest_unavailable' then
    raise exception 'Unpublished contest work catalog was visible to guests';
  end if;
end
$$;
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub', 'caf00000-0000-4000-8000-000000000001', true
);
do $$
declare
  v_data jsonb;
  v_owned bigint;
begin
  select id into v_owned from public.novels
  where title = 'CONTEST_CI_ELIGIBLE_A';

  select public.novelight_contest_entry_context() into v_data;
  if v_data->>'reason' <> 'contest_unavailable' then
    raise exception 'Entry context leaked before publication';
  end if;

  select public.novelight_contest_entry_action('enter', v_owned) into v_data;
  if v_data->>'reason' <> 'contest_unavailable' then
    raise exception 'Author entered while draft/hidden';
  end if;
end
$$;
reset role;

-- Test-only activation; the whole transaction is rolled back.
-- Keep dates future relative to the CI execution so the test is reproducible.
update public.novelight_contests
set entry_deadline_at = clock_timestamp() + interval '30 days',
    starts_at = clock_timestamp() + interval '31 days',
    ends_at = clock_timestamp() + interval '61 days',
    status = 'registration',
    public_visible = true
where contest_key = 'novelight-november-2026';

set local role authenticated;
select set_config(
  'request.jwt.claim.sub', 'caf00000-0000-4000-8000-000000000001', true
);
do $$
declare
  v_result jsonb;
  v_nine bigint;
  v_eligible bigint;
  v_other bigint;
begin
  select id into v_nine from public.novels
    where title = 'CONTEST_CI_NINE_A';
  select id into v_eligible from public.novels
    where title = 'CONTEST_CI_ELIGIBLE_A';
  select id into v_other from public.novels
    where title = 'CONTEST_CI_ELIGIBLE_B';

  select public.novelight_contest_entry_context() into v_result;
  if (v_result->>'ok')::boolean is not true
     or (v_result->>'accepting_entries')::boolean is not true then
    raise exception 'Owner entry context not ready after activation: %',
      v_result;
  end if;

  select public.novelight_contest_entry_action('enter', v_nine)
    into v_result;
  if v_result->>'reason' <> 'insufficient_published_episodes' then
    raise exception 'Nine chapters incorrectly allowed: %', v_result;
  end if;

  select public.novelight_contest_entry_action('enter', v_other)
    into v_result;
  if v_result->>'reason' <> 'not_owned_published_work' then
    raise exception 'Other author work allowed: %', v_result;
  end if;

  select public.novelight_contest_entry_action('enter', v_eligible)
    into v_result;
  if v_result->>'state' <> 'entered' then
    raise exception 'Ten-chapter owned work rejected: %', v_result;
  end if;

  select public.novelight_contest_entry_action('enter', v_eligible)
    into v_result;
  if v_result->>'state' <> 'already_entered' then
    raise exception 'Idempotent double click failed: %', v_result;
  end if;

  select public.novelight_contest_entry_action('withdraw', null)
    into v_result;
  if v_result->>'state' <> 'withdrawn' then
    raise exception 'Entry withdrawal failed: %', v_result;
  end if;

  select public.novelight_contest_entry_action('enter', v_eligible)
    into v_result;
  if v_result->>'state' <> 'entered' then
    raise exception 'Re-enrollment failed: %', v_result;
  end if;
end
$$;
reset role;

do $$
declare
  v_entries integer;
  v_novel_id bigint;
begin
  select count(*) into v_entries
  from public.novelight_contest_entries;
  if v_entries <> 1 then
    raise exception 'One-author / one-work invariant failed: %', v_entries;
  end if;

  select e.novel_id into v_novel_id
  from public.novelight_contest_entries e;
  if v_novel_id <> (
    select id from public.novels
    where title = 'CONTEST_CI_ELIGIBLE_A'
  ) then
    raise exception 'Unexpected enrolled work';
  end if;
end
$$;

set local role anon;
do $$
declare v_result jsonb;
begin
  select public.novelight_public_contest_catalog(24, 0) into v_result;
  if (v_result->>'ok')::boolean is not true
     or (v_result->>'total_entries')::integer <> 1
     or jsonb_array_length(v_result->'entries') <> 1
     or (v_result->'entries'->0->>'title') <> 'CONTEST_CI_ELIGIBLE_A'
     or v_result::text like '%caf00000-0000-4000-8000-000000000001%' then
    raise exception 'Public catalog included invalid or personal content: %',
      v_result;
  end if;
end
$$;
reset role;

-- Never leave draft-stage test activation running, even in disposable DB.
update public.novelight_contests
set status = 'draft', public_visible = false
where contest_key = 'novelight-november-2026';

do $$
declare v_count integer;
begin
  select count(*) into v_count from public.novelight_contest_entries;
  if v_count <> 1 then
    raise exception 'Unexpected entry mutation while pausing';
  end if;
end
$$;

rollback;

select 'PASS: November contest migrated schema, owner RPC, private RLS and catalog on disposable replay DB' as result;
