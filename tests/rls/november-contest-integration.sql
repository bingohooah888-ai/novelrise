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
  'official/caf00000-0000-4000-8000-000000000003.webp',
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

  select public.novelight_contest_entry_action_v2('enter', v_owned)
    into v_data;
  if v_data->>'reason' <> 'contest_unavailable' then
    raise exception 'Author entered while draft/hidden';
  end if;
end
$$;
reset role;

-- Even setting 'registration' must fail closed while no official terms
-- version/URL has been approved by an operator.
do $prelaunch_terms$
declare v_blocked boolean := false;
begin
  begin
    update public.novelight_contests
       set status = 'registration', public_visible = true
     where contest_key = 'novelight-november-2026';
  exception when check_violation then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'Unconfigured official contest terms allowed activation';
  end if;
end
$prelaunch_terms$;

-- Test-only activation; the whole transaction is rolled back.
-- Keep dates future relative to the CI execution so the test is reproducible.
update public.novelight_contests
set entry_deadline_at = clock_timestamp() + interval '30 days',
    starts_at = clock_timestamp() + interval '31 days',
    ends_at = clock_timestamp() + interval '61 days',
    status = 'registration',
    public_visible = true,
    terms_version = 'ci-contest-v1',
    terms_url = 'https://novelight.jp/contest-terms-ci'
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

  -- Legacy cached clients and mismatched consent can never enter.
  select public.novelight_contest_entry_action('enter', v_eligible)
    into v_result;
  if v_result->>'reason' <> 'terms_consent_required' then
    raise exception 'Legacy entry bypassed terms consent: %', v_result;
  end if;
  select public.novelight_contest_entry_action_v2(
    'enter', v_eligible, 'novelight-november-2026', 'wrong-version'
  ) into v_result;
  if v_result->>'reason' <> 'terms_consent_required' then
    raise exception 'Wrong terms version bypassed consent: %', v_result;
  end if;

  select public.novelight_contest_entry_action_v2('enter', v_nine,
    'novelight-november-2026', 'ci-contest-v1')
    into v_result;
  if v_result->>'reason' <> 'insufficient_published_episodes' then
    raise exception 'Nine chapters incorrectly allowed: %', v_result;
  end if;

  select public.novelight_contest_entry_action_v2('enter', v_other,
    'novelight-november-2026', 'ci-contest-v1')
    into v_result;
  if v_result->>'reason' <> 'not_owned_published_work' then
    raise exception 'Other author work allowed: %', v_result;
  end if;

  select public.novelight_contest_entry_action_v2('enter', v_eligible,
    'novelight-november-2026', 'ci-contest-v1')
    into v_result;
  if v_result->>'state' <> 'entered' then
    raise exception 'Ten-chapter owned work rejected: %', v_result;
  end if;

  select public.novelight_contest_entry_action_v2('enter', v_eligible,
    'novelight-november-2026', 'ci-contest-v1')
    into v_result;
  if v_result->>'state' <> 'already_entered' then
    raise exception 'Idempotent double click failed: %', v_result;
  end if;

  select public.novelight_contest_entry_action('withdraw', null)
    into v_result;
  if v_result->>'state' <> 'withdrawn' then
    raise exception 'Entry withdrawal failed: %', v_result;
  end if;

  select public.novelight_contest_entry_action_v2('enter', v_eligible,
    'novelight-november-2026', 'ci-contest-v1')
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
  if not exists (
    select 1 from public.novelight_contest_entries
     where terms_accepted_version = 'ci-contest-v1'
       and terms_accepted_at is not null
  ) then
    raise exception 'No server-recorded contest terms acceptance evidence';
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

-- Entry eligibility rejects owner work that moves into a restricted zone,
-- even if the same author already enrolled the work. The fixture is rolled
-- back as part of the containing transaction; no Production data is changed.
update public.novels
set content_rating = 'adult_18_nonsexual',
    content_warnings = array['gore']::text[]
where title = 'CONTEST_CI_ELIGIBLE_A';

set local role authenticated;
select set_config(
  'request.jwt.claim.sub', 'caf00000-0000-4000-8000-000000000001', true
);
do $category_r18$
declare
  v_work bigint;
  v_result jsonb;
begin
  select id into v_work from public.novels
   where title = 'CONTEST_CI_ELIGIBLE_A';
  select public.novelight_contest_entry_action_v2(
    'enter', v_work, 'novelight-november-2026', 'ci-contest-v1'
  ) into v_result;
  if v_result->>'reason' <> 'ineligible_work_category' then
    raise exception 'Owner R18 work bypassed entry-category gate: %', v_result;
  end if;
end
$category_r18$;
reset role;

update public.novels
set content_rating = 'general',
    content_warnings = array[]::text[],
    ai_usage = 'ai_generated'
where title = 'CONTEST_CI_ELIGIBLE_A';

set local role authenticated;
select set_config(
  'request.jwt.claim.sub', 'caf00000-0000-4000-8000-000000000001', true
);
do $category_ai$
declare
  v_work bigint;
  v_result jsonb;
begin
  select id into v_work from public.novels
   where title = 'CONTEST_CI_ELIGIBLE_A';
  select public.novelight_contest_entry_action_v2(
    'enter', v_work, 'novelight-november-2026', 'ci-contest-v1'
  ) into v_result;
  if v_result->>'reason' <> 'ineligible_work_category' then
    raise exception 'Owner AI-generated work bypassed eligibility: %', v_result;
  end if;
end
$category_ai$;
reset role;

update public.novels
set content_rating = 'sensitive_15',
    content_warnings = array['violence']::text[],
    ai_usage = 'ai_assisted'
where title = 'CONTEST_CI_ELIGIBLE_A';

set local role authenticated;
select set_config(
  'request.jwt.claim.sub', 'caf00000-0000-4000-8000-000000000001', true
);
do $category_r15$
declare
  v_work bigint;
  v_result jsonb;
begin
  select id into v_work from public.novels
   where title = 'CONTEST_CI_ELIGIBLE_A';
  select public.novelight_contest_entry_action_v2(
    'enter', v_work, 'novelight-november-2026', 'ci-contest-v1'
  ) into v_result;
  if v_result->>'state' <> 'already_entered' then
    raise exception 'R15 AI-assisted author work incorrectly excluded: %',
      v_result;
  end if;
end
$category_r15$;
reset role;

update public.novels
set content_rating = 'general',
    content_warnings = array[]::text[],
    ai_usage = 'human'
where title = 'CONTEST_CI_ELIGIBLE_A';

-- The earlier authenticated RPC fixture set request.jwt.claim.sub via a
-- transaction-local GUC. Clear it before inserting test works for other owners.
-- Otherwise pre-existing ownership guards correctly reject these fixtures.
select set_config('request.jwt.claim.sub', '', true);

-- General-zone listing protection; direct SQL inserts are isolated fixtures,
-- not an implementation of the author entry workflow or an eligibility ruling.
insert into auth.users (id, raw_user_meta_data) values
  ('caf00000-0000-4000-8000-000000000004', '{"display_name":"CI R18"}'::jsonb),
  ('caf00000-0000-4000-8000-000000000005', '{"display_name":"CI AI"}'::jsonb);

update public.novels
set content_rating = 'sensitive_15',
    content_warnings = array['violence']::text[]
where title = 'CONTEST_CI_ELIGIBLE_B';

insert into public.novels (
  user_id, title, description, genre, status, created_at,
  ai_usage, content_rating, content_warnings,
  content_policy_ack, content_policy_version, thumbnail_asset_id
) values
  (
    'caf00000-0000-4000-8000-000000000004',
    'CONTEST_CI_ZONE_R18',
    'R18 zone test only',
    'ホラー', 'published', '2026-09-20T00:00:00Z',
    'human', 'adult_18_nonsexual', array['gore']::text[],
    true, 'beta-2026-08-23',
    'caf00000-0000-4000-8000-000000000003'
  ),
  (
    'caf00000-0000-4000-8000-000000000005',
    'CONTEST_CI_ZONE_AI',
    'AI zone test only',
    'SF', 'published', '2026-09-20T00:00:00Z',
    'ai_generated', 'general', array[]::text[],
    true, 'beta-2026-08-23',
    'caf00000-0000-4000-8000-000000000003'
  );

insert into public.episodes (
  novel_id, user_id, episode_number, title, content, status, pv
)
select n.id, n.user_id, gs.n, 'CI zone episode ' || gs.n,
       repeat('Zone test text. ', 24), 'published', 0
from public.novels n
cross join lateral generate_series(1, 10) as gs(n)
where n.title in ('CONTEST_CI_ZONE_R18', 'CONTEST_CI_ZONE_AI');

insert into public.novelight_contest_entries (
  contest_id, author_id, novel_id, novel_title_snapshot,
  published_episodes_at_entry
)
select c.id, n.user_id, n.id, n.title, 10
from public.novelight_contests c
cross join public.novels n
where c.contest_key = 'novelight-november-2026'
  and n.title in (
    'CONTEST_CI_ELIGIBLE_B',
    'CONTEST_CI_ZONE_R18',
    'CONTEST_CI_ZONE_AI'
  );

set local role anon;
do $contest_zoning$
declare
  v_all jsonb;
  v_no_r15 jsonb;
  v_legacy jsonb;
  v_page jsonb;
begin
  select public.novelight_public_contest_catalog_filtered(24,0,true)
    into v_all;
  select public.novelight_public_contest_catalog_filtered(24,0,false)
    into v_no_r15;
  select public.novelight_public_contest_catalog(24,0) into v_legacy;

  if (v_all->>'total_entries')::integer <> 2
    or jsonb_array_length(v_all->'entries') <> 2
    or (v_no_r15->>'total_entries')::integer <> 1
    or jsonb_array_length(v_no_r15->'entries') <> 1
    or (v_legacy->>'total_entries')::integer <> 2 then
    raise exception 'R15 preference / legacy count mismatch: % | % | %',
      v_all, v_no_r15, v_legacy;
  end if;

  if v_all::text like '%CONTEST_CI_ZONE_R18%'
    or v_all::text like '%CONTEST_CI_ZONE_AI%'
    or v_legacy::text like '%CONTEST_CI_ZONE_R18%'
    or v_legacy::text like '%CONTEST_CI_ZONE_AI%'
    or v_no_r15::text like '%CONTEST_CI_ELIGIBLE_B%'
    or v_no_r15::text not like '%CONTEST_CI_ELIGIBLE_A%' then
    raise exception 'General-zone reader was shown hidden R18/AI/R15 rows';
  end if;

  select public.novelight_public_contest_catalog_filtered(1,1,true)
    into v_page;
  if (v_page->>'total_entries')::integer <> 2
    or jsonb_array_length(v_page->'entries') <> 1 then
    raise exception 'Filtered catalog pagination count drift: %', v_page;
  end if;
end
$contest_zoning$;
reset role;

-- Never leave draft-stage test activation running, even in disposable DB.
update public.novelight_contests
set status = 'draft', public_visible = false
where contest_key = 'novelight-november-2026';

do $$
declare v_count integer;
begin
  select count(*) into v_count from public.novelight_contest_entries;
  if v_count <> 4 then
    raise exception 'Unexpected entry mutation while pausing';
  end if;
end
$$;

rollback;

select 'PASS: November contest migrated schema, owner RPC, private RLS and catalog on disposable replay DB' as result;
