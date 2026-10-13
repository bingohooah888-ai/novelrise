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
  select public.novelight_contest_entry_context(
    'novelight-november-2026'
  ) into v_result;
  if not exists (
    select 1
      from jsonb_array_elements(v_result->'works') as w
     where w->>'title' = 'CONTEST_CI_ELIGIBLE_A'
       and w->>'eligible' = 'false'
  ) then
    raise exception 'Owner R18 work incorrectly marked eligible: %', v_result;
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

-- Stage 06 scoring core: all test mutations remain inside disposable rollback.
do $score_permissions$
begin
  if has_function_privilege(
       'anon',
       'public.novelight_contest_record_qualified_session(uuid)',
       'execute'
     )
     or has_function_privilege(
       'authenticated',
       'public.novelight_contest_record_qualified_session(uuid)',
       'execute'
     )
     or has_function_privilege(
       'anon',
       'public.novelight_contest_recompute_reader_score(uuid,uuid,uuid)',
       'execute'
     )
     or has_function_privilege(
       'authenticated',
       'public.novelight_contest_recompute_reader_score(uuid,uuid,uuid)',
       'execute'
     )
     or has_table_privilege(
       'anon', 'public.novelight_contest_read_events', 'insert'
     ) then
    raise exception 'Stage 06 reader event writes were exposed';
  end if;
  if not has_function_privilege(
    'service_role',
    'public.novelight_contest_record_qualified_session(uuid)',
    'execute'
  ) then
    raise exception 'Trusted score ingestion cannot access service-only RPC';
  end if;
  if public.novelight_contest_episode_points(0) <> 0
    or public.novelight_contest_episode_points(2) <> 0
    or public.novelight_contest_episode_points(3) <> 1
    or public.novelight_contest_episode_points(4) <> 1
    or public.novelight_contest_episode_points(5) <> 3
    or public.novelight_contest_episode_points(9) <> 3
    or public.novelight_contest_episode_points(10) <> 5
    or public.novelight_contest_episode_points(100) <> 5 then
    raise exception 'The 0/1/3/5 score thresholds drifted';
  end if;
end
$score_permissions$;

do $contest_score_fixture$
declare
  v_contest_id uuid;
  v_entry_id uuid;
  v_novel_id bigint;
  v_reader_id uuid := 'caf00000-0000-4000-8000-000000000020';
  v_owner_reader uuid := 'caf00000-0000-4000-8000-000000000022';
  v_guest_reader uuid := 'caf00000-0000-4000-8000-000000000023';
  v_episode_id bigint;
  v_session uuid;
  v_result jsonb;
  v_count integer := 0;
  v_points integer;
  v_events integer;
  v_existing_pv bigint;
  v_current_pv bigint;
begin
  select c.id, e.id, e.novel_id
  into v_contest_id, v_entry_id, v_novel_id
  from public.novelight_contests c
  join public.novelight_contest_entries e on e.contest_id = c.id
  join public.novels n on n.id = e.novel_id
  where n.title = 'CONTEST_CI_ELIGIBLE_A';

  insert into public.novelight_contest_readers (
    id, contest_id, kind, user_id
  ) values
    (
      v_reader_id, v_contest_id, 'account',
      'caf00000-0000-4000-8000-000000000021'
    ),
    (
      v_owner_reader, v_contest_id, 'account',
      'caf00000-0000-4000-8000-000000000001'
    );
  insert into public.novelight_contest_readers (
    id, contest_id, kind, guest_key_hash
  ) values (v_guest_reader, v_contest_id, 'guest', repeat('a',64));

  select pg_catalog.sum(pv) into v_existing_pv from public.episodes
    where novel_id = v_novel_id;

  -- Even a pre-qualified (internal) session must not credit while hidden.
  select id into v_episode_id from public.episodes
    where novel_id = v_novel_id order by episode_number limit 1;
  insert into public.novelight_contest_read_sessions (
    contest_id, reader_id, entry_id, episode_id_snapshot, status
  ) values (
    v_contest_id, v_reader_id, v_entry_id, v_episode_id, 'qualified'
  ) returning id into v_session;
  select public.novelight_contest_record_qualified_session(v_session)
    into v_result;
  if v_result->>'reason' <> 'contest_inactive' then
    raise exception 'Draft contest credited a read: %',v_result;
  end if;

  -- Travel a disposal-only fixture into a current contest window, never live.
  update public.novelight_contests
    set entry_deadline_at = pg_catalog.clock_timestamp() - interval '2 hours',
        starts_at = pg_catalog.clock_timestamp() - interval '1 hour',
        ends_at = pg_catalog.clock_timestamp() + interval '1 hour',
        terms_version = 'ci-contest-v1',
        terms_url = 'https://novelight.jp/contest-terms',
        status = 'active', public_visible = true
  where id = v_contest_id;

  for v_episode_id in
    select id from public.episodes
     where novel_id = v_novel_id and status = 'published'
     order by episode_number
  loop
    insert into public.novelight_contest_read_sessions (
      contest_id, reader_id, entry_id, episode_id_snapshot, status
    ) values (
      v_contest_id, v_reader_id, v_entry_id, v_episode_id, 'qualified'
    ) returning id into v_session;

    select public.novelight_contest_record_qualified_session(v_session)
      into v_result;
    v_count := v_count + 1;
    v_points := case when v_count >= 10 then 5
                     when v_count >= 5 then 3
                     when v_count >= 3 then 1
                     else 0 end;
    if v_result->>'ok' <> 'true'
      or v_result->>'new_episode' <> 'true'
      or (v_result->>'points')::integer <> v_points
      or (v_result->>'qualified_episodes')::integer <> v_count then
      raise exception 'Read #%, expected % points: %', v_count, v_points, v_result;
    end if;
    -- Duplicate session and replaying it can never create a second event.
    select public.novelight_contest_record_qualified_session(v_session)
      into v_result;
    if v_result->>'new_episode' <> 'false'
       or (v_result->>'points')::integer <> v_points then
      raise exception 'Read replay credited twice: %',v_result;
    end if;
  end loop;

  select pg_catalog.count(*) into v_events
    from public.novelight_contest_read_events
   where reader_id = v_reader_id and entry_id = v_entry_id;
  if v_events <> 10 or v_count <> 10 then
    raise exception 'A repeated episode was counted twice';
  end if;

  -- Fraud review must be able to revoke credit without touching ordinary PV.
  update public.novelight_contest_read_events
     set status = 'review_hold'
   where reader_id = v_reader_id and entry_id = v_entry_id
     and episode_id_snapshot in (
       select id from public.episodes
        where novel_id = v_novel_id and episode_number between 1 and 6
     );
  select public.novelight_contest_recompute_reader_score(
    v_contest_id, v_reader_id, v_entry_id
  ) into v_result;
  if (v_result->>'qualified_episodes')::integer <> 4
     or (v_result->>'points')::integer <> 1 then
    raise exception 'Hold failed to reduce award credit: %',v_result;
  end if;

  update public.novelight_contest_readers
     set review_status = 'review_hold'
   where id = v_reader_id;
  select public.novelight_contest_recompute_reader_score(
    v_contest_id, v_reader_id, v_entry_id
  ) into v_result;
  if (v_result->>'points')::integer <> 0
    or v_result->>'review_status' <> 'review_hold' then
    raise exception 'Reader-level hold counted points: %',v_result;
  end if;

  -- Operator state transitions must update scoring in the SAME transaction.
  -- Six of ten episode events remain individually held; four are eligible.
  select public.novelight_contest_admin_review_reader(
    v_contest_id,v_reader_id,
    'caf00000-0000-4000-8000-000000000091',
    'reopen','review_hold','appeal_review',
    'Contest reader contested the prior automatic evidence hold'
  ) into v_result;
  if v_result->>'review_status' <> 'provisional' or
     (select points from public.novelight_contest_reader_scores
       where reader_id = v_reader_id and entry_id = v_entry_id) <> 1 then
    raise exception 'Reopen did not safely restore provisional work score: %',v_result;
  end if;

  select public.novelight_contest_admin_review_reader(
    v_contest_id,v_reader_id,
    'caf00000-0000-4000-8000-000000000091',
    'clear','provisional','manual_evidence',
    'Independent verification reviewed the underlying episode ledger'
  ) into v_result;
  if v_result->>'review_status' <> 'cleared' or
     (select review_status from public.novelight_contest_reader_scores
       where reader_id = v_reader_id and entry_id = v_entry_id) <> 'cleared' or
     (select points from public.novelight_contest_reader_scores
       where reader_id = v_reader_id and entry_id = v_entry_id) <> 1 then
    raise exception 'Cleared operator score did not match evidence: %',v_result;
  end if;

  select public.novelight_contest_admin_review_reader(
    v_contest_id,v_reader_id,
    'caf00000-0000-4000-8000-000000000091',
    'hold','cleared','manual_evidence',
    'New conflicting evidence requires manual review of cleared state'
  ) into v_result;
  if v_result->>'review_status' <> 'review_hold' or
     (select points from public.novelight_contest_reader_scores
       where reader_id = v_reader_id and entry_id = v_entry_id) <> 0 then
    raise exception 'Hold after clearance failed to suppress score: %',v_result;
  end if;

  -- An account reading its author's work never yields an award point.
  insert into public.novelight_contest_read_sessions (
    contest_id, reader_id, entry_id, episode_id_snapshot, status
  ) values (
    v_contest_id, v_owner_reader, v_entry_id, v_episode_id, 'qualified'
  ) returning id into v_session;
  select public.novelight_contest_record_qualified_session(v_session)
    into v_result;
  if v_result->>'reason' <> 'self_read' then
    raise exception 'Author self-read credited: %',v_result;
  end if;

  -- A pseudonymous guest can reach 3 distinct episodes, never full-account proof.
  v_count := 0;
  for v_episode_id in
    select id from public.episodes
     where novel_id = v_novel_id order by episode_number limit 3
  loop
    insert into public.novelight_contest_read_sessions (
      contest_id, reader_id, entry_id, episode_id_snapshot, status
    ) values (
      v_contest_id, v_guest_reader, v_entry_id, v_episode_id, 'qualified'
    ) returning id into v_session;
    select public.novelight_contest_record_qualified_session(v_session)
      into v_result;
    v_count := v_count + 1;
  end loop;
  if (v_result->>'qualified_episodes')::integer <> 3
    or (v_result->>'points')::integer <> 1 then
    raise exception 'Guest scored incorrectly: %',v_result;
  end if;

  select pg_catalog.sum(pv) into v_current_pv from public.episodes
    where novel_id = v_novel_id;
  if v_current_pv is distinct from v_existing_pv then
    raise exception 'Contest scoring mutated ordinary episode PV';
  end if;

  update public.novelight_contests
    set status = 'draft', public_visible = false where id = v_contest_id;
  select public.novelight_contest_record_qualified_session(v_session)
    into v_result;
  if v_result->>'reason' <> 'contest_inactive' then
    raise exception 'Draft contest still credited a qualified session';
  end if;
end
$contest_score_fixture$;


-- Stage 06 part B: authorized session creation and server-timed heartbeat
-- verified exclusively in the disposable migration replay transaction.
do $session_security$
begin
  if has_function_privilege(
     'anon', 'public.novelight_contest_begin_read_session(uuid,bigint,text)',
     'execute'
   ) or has_function_privilege(
     'authenticated',
     'public.novelight_contest_begin_read_session(uuid,bigint,text)',
     'execute'
   ) or has_function_privilege(
     'anon',
     'public.novelight_contest_heartbeat_read_session(uuid,uuid,integer,numeric,boolean,boolean)',
     'execute'
   ) or has_function_privilege(
     'authenticated',
     'public.novelight_contest_heartbeat_read_session(uuid,uuid,integer,numeric,boolean,boolean)',
     'execute'
   ) then
    raise exception 'Stage 06 session RPC exposed to browser roles';
  end if;
  if not has_function_privilege(
    'service_role',
    'public.novelight_contest_heartbeat_read_session(uuid,uuid,integer,numeric,boolean,boolean)',
    'execute'
  ) then
    raise exception 'Trusted backend heartbeat role unavailable';
  end if;
end
$session_security$;

do $session_integrated$
declare
  v_contest_id uuid;
  v_episode_id bigint;
  v_reader_id uuid := 'caf00000-0000-4000-8000-000000000020';
  v_guest_reader uuid := 'caf00000-0000-4000-8000-000000000023';
  v_owner_reader uuid := 'caf00000-0000-4000-8000-000000000022';
  v_session uuid;
  v_tts_session uuid;
  v_bg_session uuid;
  v_result jsonb;
  v_number integer;
begin
  select c.id, ep.id into v_contest_id, v_episode_id
    from public.novelight_contests c
    join public.novelight_contest_entries en
      on en.contest_id = c.id
    join public.novels n on n.id = en.novel_id
    join public.episodes ep on ep.novel_id = n.id
   where c.contest_key = 'novelight-november-2026'
     and n.title = 'CONTEST_CI_ELIGIBLE_A'
     and ep.episode_number = 1;

  update public.novelight_contest_readers
     set review_status = 'provisional'
   where id = v_reader_id;
  select public.novelight_contest_begin_read_session(
    v_reader_id, v_episode_id, 'scroll'
  ) into v_result;
  if v_result->>'reason' <> 'contest_inactive' then
    raise exception 'Draft contest issued a reader session: %', v_result;
  end if;

  update public.novelight_contests
     set entry_deadline_at = pg_catalog.clock_timestamp() - interval '2 hours',
         starts_at = pg_catalog.clock_timestamp() - interval '1 hour',
         ends_at = pg_catalog.clock_timestamp() + interval '1 hour',
         status = 'active',
         public_visible = true,
         terms_version = 'ci-contest-v1',
         terms_url = 'https://novelight.jp/contest-terms'
   where id = v_contest_id;

  select public.novelight_contest_begin_read_session(
    v_owner_reader, v_episode_id, 'scroll'
  ) into v_result;
  if v_result->>'reason' <> 'self_read' then
    raise exception 'Author obtained a contest session: %', v_result;
  end if;

  select public.novelight_contest_begin_read_session(
    v_reader_id, v_episode_id, 'forged_mode'
  ) into v_result;
  if v_result->>'reason' <> 'invalid_request' then
    raise exception 'Invalid mode accepted: %', v_result;
  end if;

  select public.novelight_contest_begin_read_session(
    v_reader_id, v_episode_id, 'scroll'
  ) into v_result;
  if v_result->>'ok' <> 'true' or v_result->>'session_id' is null then
    raise exception 'Real reader could not start session: %',v_result;
  end if;
  v_session := (v_result->>'session_id')::uuid;

  select public.novelight_contest_heartbeat_read_session(
    v_session, v_guest_reader, 1, 0.3, true, true
  ) into v_result;
  if v_result->>'reason' <> 'session_missing' then
    raise exception 'Guest took over account session: %',v_result;
  end if;
  select public.novelight_contest_heartbeat_read_session(
    v_session, v_reader_id, 1, 1.4, true, true
  ) into v_result;
  if v_result->>'reason' <> 'invalid_request' then
    raise exception 'Out-of-range progress accepted: %',v_result;
  end if;
  select public.novelight_contest_heartbeat_read_session(
    v_session, v_reader_id, 1, 1, true, true
  ) into v_result;
  if v_result->>'reason' <> 'invalid_interval' then
    raise exception 'Immediate fake completion heartbeat accepted: %',v_result;
  end if;

  -- Backdate private timestamps only inside the disposable fixture; the
  -- migration uses immutable database clock measurements in Production.
  for v_number in 1..4 loop
    update public.novelight_contest_read_sessions
       set last_heartbeat_at = pg_catalog.clock_timestamp() - interval '12 seconds'
     where id = v_session;
    select public.novelight_contest_heartbeat_read_session(
      v_session, v_reader_id, v_number,
      v_number::numeric / 4, true, v_number = 2
    ) into v_result;
    if v_result->>'ok' <> 'true' then
      raise exception 'Sequential heartbeat #% rejected: %',v_number,v_result;
    end if;
    if v_number < 4 and v_result->>'qualified' <> 'false' then
      raise exception 'Reading was prematurely qualified at #%: %',v_number,v_result;
    end if;
  end loop;
  if v_result->>'qualified' <> 'true' then
    raise exception 'Four sequential valid heartbeats not qualified: %',v_result;
  end if;

  select public.novelight_contest_heartbeat_read_session(
    v_session, v_reader_id, 4, 1, true, true
  ) into v_result;
  if v_result->>'qualified' <> 'true' then
    raise exception 'Already qualified heartbeat was not idempotent: %',v_result;
  end if;

  select public.novelight_contest_begin_read_session(
    v_guest_reader, v_episode_id, 'tts'
  ) into v_result;
  v_tts_session := (v_result->>'session_id')::uuid;
  if v_result->>'ok' <> 'true' then
    raise exception 'Guest TTS start denied: %',v_result;
  end if;

  for v_number in 1..4 loop
    update public.novelight_contest_read_sessions
       set last_heartbeat_at = pg_catalog.clock_timestamp() - interval '12 seconds'
     where id = v_tts_session;
    select public.novelight_contest_heartbeat_read_session(
      v_tts_session, v_guest_reader, v_number,
      v_number::numeric / 4, true, v_number = 1
    ) into v_result;
    if v_result->>'ok' <> 'true' then
      raise exception 'Guest TTS heartbeat failed: %',v_result;
    end if;
  end loop;
  if v_result->>'qualified' <> 'true'
     or (v_result->>'foreground_seconds')::integer < 45 then
    raise exception 'TTS verified interval failed: %',v_result;
  end if;

  select public.novelight_contest_begin_read_session(
    v_guest_reader, v_episode_id, 'scroll'
  ) into v_result;
  v_bg_session := (v_result->>'session_id')::uuid;
  update public.novelight_contest_read_sessions
     set last_heartbeat_at = pg_catalog.clock_timestamp() - interval '12 seconds'
   where id = v_bg_session;
  select public.novelight_contest_heartbeat_read_session(
    v_bg_session, v_guest_reader, 1, 1, false, true
  ) into v_result;
  if v_result->>'qualified' <> 'false'
     or (v_result->>'foreground_seconds')::integer <> 0 then
    raise exception 'Background time produced contest credit: %',v_result;
  end if;

  update public.novelight_contests
     set status = 'draft',public_visible = false where id = v_contest_id;
  select public.novelight_contest_begin_read_session(
    v_reader_id, v_episode_id, 'scroll'
  ) into v_result;
  if v_result->>'reason' <> 'contest_inactive' then
    raise exception 'Draft contest reissued scoring sessions';
  end if;
  select public.novelight_contest_heartbeat_read_session(
    v_session, v_reader_id, 5, 1, true, true
  ) into v_result;
  if v_result->>'reason' <> 'contest_inactive' then
    raise exception 'Draft contest accepted a heartbeat';
  end if;
end
$session_integrated$;

-- Guest-to-account consolidation, exercised inside a disposable transaction.
do $guest_account_proof$
declare
  v_contest uuid;
  v_entry uuid;
  v_novel bigint;
  v_episode bigint;
  v_session uuid;
  v_target uuid := 'caf00000-0000-4000-8000-000000000024';
  v_target_user uuid := 'caf00000-0000-4000-8000-000000000025';
  v_guest uuid := 'caf00000-0000-4000-8000-000000000023';
  v_result jsonb;
  v_points integer;
  v_count integer;
begin
  if pg_catalog.has_function_privilege(
    'anon',
    'public.novelight_contest_link_guest_account(uuid,text,uuid)',
    'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'authenticated',
    'public.novelight_contest_link_guest_account(uuid,text,uuid)',
    'EXECUTE'
  ) then
    raise exception 'Guest link privilege leaked to browser clients';
  end if;

  select c.id,en.id,en.novel_id into v_contest,v_entry,v_novel
    from public.novelight_contests c
    join public.novelight_contest_entries en on en.contest_id = c.id
    join public.novels n on n.id = en.novel_id
   where n.title = 'CONTEST_CI_ELIGIBLE_A';
  select public.novelight_contest_link_guest_account(
    v_contest,repeat('a',64),v_target_user
  ) into v_result;
  if v_result->>'reason' <> 'contest_inactive' then
    raise exception 'Hidden contest allowed a guest claim';
  end if;

  update public.novelight_contests
     set status = 'active',public_visible = true
   where id = v_contest;

  insert into public.novelight_contest_readers (
    id,contest_id,kind,user_id
  ) values (v_target,v_contest,'account',v_target_user);

  -- An already-cleared account must be returned to provisional review after
  -- a new guest claim, rather than silently carrying old clearance forward.
  update public.novelight_contest_readers
     set review_status = 'cleared' where id = v_target;

  -- Target already read episode 1 and 4; guest read episode 1, 2 and 3.
  for v_episode in
    select id from public.episodes
     where novel_id = v_novel and episode_number in (1,4)
  loop
    insert into public.novelight_contest_read_sessions (
      contest_id,reader_id,entry_id,episode_id_snapshot,status
    ) values (
      v_contest,v_target,v_entry,v_episode,'qualified'
    ) returning id into v_session;
    select public.novelight_contest_record_qualified_session(v_session)
      into v_result;
  end loop;

  select public.novelight_contest_link_guest_account(
    v_contest,repeat('a',64),v_target_user
  ) into v_result;
  if v_result->>'ok' <> 'true'
    or v_result->>'linked' <> 'true'
    or (v_result->>'copied_episodes')::integer <> 2 then
    raise exception 'Distinct episode consolidation failed: %',v_result;
  end if;

  select qualified_episode_count,points into v_count,v_points
    from public.novelight_contest_reader_scores
   where contest_id = v_contest
     and reader_id = v_target and entry_id = v_entry;
  if v_count <> 4 or v_points <> 1 then
    raise exception 'Merged overlap was double counted: %/%',v_count,v_points;
  end if;
  if not exists (
    select 1 from public.novelight_contest_reader_scores
     where reader_id = v_target and entry_id = v_entry
       and review_status = 'provisional'
  ) then
    raise exception 'Account clearance was not downgraded on new guest evidence';
  end if;

  select points into v_points
    from public.novelight_contest_reader_scores
   where contest_id = v_contest and reader_id = v_guest
     and entry_id = v_entry;
  if v_points <> 0 or not exists (
    select 1 from public.novelight_contest_readers
     where id = v_guest and review_status = 'merged'
       and merged_into_reader_id = v_target
  ) then
    raise exception 'Guest points not retired after consolidation';
  end if;

  select public.novelight_contest_link_guest_account(
    v_contest,repeat('a',64),v_target_user
  ) into v_result;
  if v_result->>'already_linked' <> 'true' then
    raise exception 'Link replay was not idempotent: %',v_result;
  end if;

  select public.novelight_contest_link_guest_account(
    v_contest,repeat('a',64),
    'caf00000-0000-4000-8000-000000000029'
  ) into v_result;
  if v_result->>'reason' <> 'guest_already_linked' then
    raise exception 'Guest was rebound to another account: %',v_result;
  end if;

  select id into v_session
    from public.novelight_contest_read_sessions
   where reader_id = v_guest and status = 'qualified' limit 1;
  if v_session is not null then
    select public.novelight_contest_record_qualified_session(v_session)
      into v_result;
    if v_result->>'reason' <> 'not_eligible' then
      raise exception 'Retired guest session scored again: %',v_result;
    end if;
  end if;

  update public.novelight_contests
     set status = 'draft',public_visible = false
   where id = v_contest;
end
$guest_account_proof$;


-- Stage 08 provisional rankings never publish while the contest is hidden.
do $ranking_proof$
declare
  v_contest uuid;
  v_entry uuid;
  v_novel bigint;
  v_reader uuid := 'caf00000-0000-4000-8000-000000000030';
  v_ep bigint;
  v_build jsonb;
  v_result jsonb;
  v_row public.novelight_contest_rank_rows%rowtype;
begin
  if pg_catalog.has_function_privilege(
    'anon','public.novelight_contest_prepare_rank_snapshot(uuid,integer)',
    'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'authenticated','public.novelight_contest_publish_rank_snapshot(uuid,integer)',
    'EXECUTE'
  ) then
    raise exception 'Public roles gained access to ranking mutators';
  end if;
  select id into v_contest from public.novelight_contests
   where contest_key='novelight-november-2026';
  select public.novelight_public_contest_rankings(true) into v_result;
  if v_result->>'reason' <> 'ranking_unavailable' then
    raise exception 'Hidden contest exposed rankings: %',v_result;
  end if;
  select public.novelight_contest_prepare_rank_snapshot(v_contest,1)
    into v_result;
  if v_result->>'reason' <> 'contest_inactive' then
    raise exception 'Hidden contest allowed ranking preparation: %',v_result;
  end if;

  update public.novelight_contests
     set entry_deadline_at=pg_catalog.clock_timestamp()-interval '2 hours',
         starts_at=pg_catalog.clock_timestamp()-interval '1 hour',
         ends_at='2026-12-01 00:00:00+00'::timestamptz,
         terms_version='ci-contest-v1',
         terms_url='https://novelight.jp/contest-terms',
         status='active',public_visible=true
   where id=v_contest;

  select e.id,e.novel_id into v_entry,v_novel
    from public.novelight_contest_entries e
    join public.novels n on n.id=e.novel_id
   where e.contest_id=v_contest and n.title='CONTEST_CI_ELIGIBLE_A';
  insert into public.novelight_contest_readers (
    id,contest_id,kind,user_id
  ) values (
    v_reader,v_contest,'account',
    'caf00000-0000-4000-8000-000000000031'
  );
  for v_ep in
    select id from public.episodes where novel_id=v_novel
     and status='published' order by episode_number limit 10
  loop
    insert into public.novelight_contest_read_events (
      contest_id,reader_id,entry_id,episode_id_snapshot,
      qualified_at,status,rule_version
    ) values (
      v_contest,v_reader,v_entry,v_ep,pg_catalog.clock_timestamp(),
      'provisional','november-2026-points-v1'
    );
  end loop;
  -- Existing fixture readers were deliberately used by earlier tests.
  -- Hold them so this snapshot tests exactly one new qualified reader.
  update public.novelight_contest_readers
     set review_status='review_hold'
   where contest_id=v_contest and id<>v_reader
     and review_status in ('provisional','cleared');
  select public.novelight_contest_prepare_rank_snapshot(v_contest,1)
    into v_build;
  if v_build->>'ok' <> 'true' or
     (v_build->>'row_count')::integer < 1 then
    raise exception 'Private ranking snapshot failed: %',v_build;
  end if;
  select * into v_row from public.novelight_contest_rank_rows
   where snapshot_id=(v_build->>'snapshot_id')::uuid and entry_id=v_entry;
  if v_row.points <> 5 or v_row.ordinal_rank <> 1
     or v_row.qualifying_readers <> 1 then
    raise exception 'Stage 08 ignored distinct ten episode points: %',v_row;
  end if;
  select public.novelight_contest_prepare_rank_snapshot(v_contest,1)
    into v_result;
  if v_result->>'already_prepared' <> 'true' then
    raise exception 'Stage 08 snapshot replay not idempotent: %',v_result;
  end if;
  select public.novelight_contest_publish_rank_snapshot(v_contest,1)
    into v_result;
  if v_result->>'reason' <> 'outside_publish_window' then
    raise exception 'Rankings could publish before scheduled noon: %',v_result;
  end if;
  select public.novelight_public_contest_rankings(true) into v_result;
  if v_result->>'ok' = 'true' then
    raise exception 'Draft ranking snapshot leaked to public';
  end if;
end
$ranking_proof$;

rollback;

select 'PASS: November contest migrated schema, owner RPC, private RLS, catalog and score core and read sessions on disposable replay DB' as result;


-- Stage 06 guest credential guard (disposable replay only).
begin;
do $guest_creation_guard$
declare
  v_key text := pg_catalog.repeat('a',64);
  v_number integer;
  v_ok boolean;
begin
  if pg_catalog.has_function_privilege(
    'anon', 'public.novelight_contest_guest_creation_slot(text)', 'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'authenticated', 'public.novelight_contest_guest_creation_slot(text)', 'EXECUTE'
  ) then
    raise exception 'Guest quota RPC leaked to a browser role';
  end if;

  if public.novelight_contest_guest_creation_slot('invalid') then
    raise exception 'Untrusted fingerprint accepted';
  end if;
  for v_number in 1..6 loop
    v_ok := public.novelight_contest_guest_creation_slot(v_key);
    if v_ok is distinct from (v_number <= 5) then
      raise exception 'Guest quota violation at attempt %', v_number;
    end if;
  end loop;
  update public.novelight_contest_guest_creation_guard
     set window_started_at = pg_catalog.clock_timestamp() - interval '25 hours'
   where fingerprint = v_key;
  if not public.novelight_contest_guest_creation_slot(v_key) then
    raise exception 'Guest quota did not reopen after the 24-hour window';
  end if;
end
$guest_creation_guard$;
rollback;


-- Stage 07 private risk signals; all changes rolled back in CI.
begin;
do $risk_fixture$
declare
  v_contest uuid;
  v_account uuid;
  v_result jsonb;
  v_guest integer;
begin
  if pg_catalog.has_function_privilege(
    'anon',
    'public.novelight_contest_reader_risk_signals(uuid,uuid)',
    'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'authenticated',
    'public.novelight_contest_reader_risk_signals(uuid,uuid)',
    'EXECUTE'
  ) then
    raise exception 'Risk detection RPC leaked to ordinary readers';
  end if;

  select id into v_contest from public.novelight_contests
   where contest_key = 'novelight-november-2026';

  select public.novelight_contest_reader_risk_signals(
    v_contest,pg_catalog.gen_random_uuid()
  ) into v_result;
  if v_result->>'reason' <> 'reader_not_found' then
    raise exception 'Risk RPC revealed an unknown reader: %',v_result;
  end if;

  insert into public.novelight_contest_readers (
    contest_id,kind,user_id
  ) values (
    v_contest,'account','caf00000-0000-4000-8000-000000000089'
  ) returning id into v_account;

  select public.novelight_contest_reader_risk_signals(
    v_contest,v_account
  ) into v_result;
  if v_result->>'ok' <> 'true'
     or v_result->>'requires_manual_review' <> 'false'
     or v_result->>'review_status' <> 'provisional' then
    raise exception 'Clean reader falsely flagged: %',v_result;
  end if;

  for v_guest in 1..3 loop
    insert into public.novelight_contest_readers (
      contest_id,kind,guest_key_hash,review_status,merged_into_reader_id
    ) values (
      v_contest,'guest',
      pg_catalog.repeat(v_guest::text,64),
      'merged',v_account
    );
  end loop;

  select public.novelight_contest_reader_risk_signals(
    v_contest,v_account
  ) into v_result;
  if v_result->>'requires_manual_review' <> 'true'
     or not (v_result->'signal_codes' @>
       '["multiple_linked_guest_credentials"]'::jsonb)
     or (v_result->'metrics'->>'linked_guest_credentials')::integer <> 3 then
    raise exception 'Multi-guest claim evidence was missed: %',v_result;
  end if;
  if (select review_status
       from public.novelight_contest_readers
      where id = v_account) <> 'provisional' then
    raise exception 'Read-only risk assessment made a punitive mutation';
  end if;
end
$risk_fixture$;
rollback;
select 'PASS: stage-07 private risk signals, role isolation, non-punitive evaluation' as result;


-- Stage 07 operator review is private, serialized and audited.
begin;
do $admin_review_fixture$
declare
  v_contest uuid;
  v_reader uuid;
  v_actor uuid := 'caf00000-0000-4000-8000-000000000091';
  v_result jsonb;
  v_audits integer;
begin
  if pg_catalog.has_function_privilege(
    'anon',
    'public.novelight_contest_admin_review_reader(uuid,uuid,uuid,text,text,text,text)',
    'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'authenticated',
    'public.novelight_contest_admin_review_reader(uuid,uuid,uuid,text,text,text,text)',
    'EXECUTE'
  ) then
    raise exception 'Operator review leaked to a public role';
  end if;
  select id into v_contest from public.novelight_contests
   where contest_key = 'novelight-november-2026';
  insert into public.novelight_contest_readers (
    contest_id,kind,user_id
  ) values (
    v_contest,'account','caf00000-0000-4000-8000-000000000092'
  ) returning id into v_reader;

  select public.novelight_contest_admin_review_reader(
    v_contest,v_reader,v_actor,'hold','provisional',
    'anomalous_reading','Two anomalous reading sessions require review'
  ) into v_result;
  if v_result->>'ok' <> 'true'
    or v_result->>'review_status' <> 'review_hold'
    or (select review_status from public.novelight_contest_readers
         where id = v_reader) <> 'review_hold' then
    raise exception 'Hold not applied: %',v_result;
  end if;

  select public.novelight_contest_admin_review_reader(
    v_contest,v_reader,v_actor,'clear','provisional',
    'false_positive','This stale request must not override a hold'
  ) into v_result;
  if v_result->>'reason' <> 'stale_review' then
    raise exception 'Stale approval overwrote active hold: %',v_result;
  end if;

  select public.novelight_contest_admin_review_reader(
    v_contest,v_reader,v_actor,'clear','review_hold',
    'anomalous_reading','Insufficient reason must never clear an alert'
  ) into v_result;
  if v_result->>'reason' <> 'reason_not_sufficient' then
    raise exception 'Insufficient clear reason accepted: %',v_result;
  end if;

  select public.novelight_contest_admin_review_reader(
    v_contest,v_reader,v_actor,'reopen','review_hold',
    'appeal_review','Reader evidence will receive another human review'
  ) into v_result;
  if v_result->>'review_status' <> 'provisional' then
    raise exception 'Review re-open failed: %',v_result;
  end if;

  select public.novelight_contest_admin_review_reader(
    v_contest,v_reader,v_actor,'clear','provisional',
    'manual_evidence','Operator independently verified sufficient evidence'
  ) into v_result;
  if v_result->>'review_status' <> 'cleared' then
    raise exception 'Manual clearance failed: %',v_result;
  end if;

  select pg_catalog.count(*)::integer into v_audits
   from public.novelight_contest_review_audit
   where reader_id = v_reader and actor_user_id = v_actor
     and action like 'operator_review_%';
  if v_audits <> 3 then
    raise exception 'Audit trail missing/duplicated: %',v_audits;
  end if;

  update public.novelight_contest_readers
     set review_status = 'excluded' where id = v_reader;
  select public.novelight_contest_admin_review_reader(
    v_contest,v_reader,v_actor,'clear','cleared',
    'manual_evidence','Old reviewer state must never override excluded'
  ) into v_result;
  if v_result->>'reason' <> 'stale_review' then
    raise exception 'Excluded reader was reactivated: %',v_result;
  end if;
end
$admin_review_fixture$;
rollback;
select 'PASS: Stage 07 operator review role isolation, stale locks, audit and safe statuses' as result;

-- Step 08 part B: isolated operator/Cron boundaries, no Production change.
begin;
do $release_fixture$
declare
  v_contest uuid;
  v_view jsonb;
  v_out jsonb;
begin
  if pg_catalog.has_function_privilege(
    'anon','public.novelight_contest_admin_rank_action(uuid,integer,uuid,text,uuid,text,text)',
    'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'authenticated','public.novelight_contest_rank_release_preview(uuid,integer)',
    'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'anon','public.novelight_contest_auto_prepare_rank_slot(uuid,integer)',
    'EXECUTE'
  ) then
    raise exception 'Untrusted role acquired a private ranking operation';
  end if;
  select id into v_contest from public.novelight_contests
   where contest_key='novelight-november-2026';
  select public.novelight_contest_rank_release_preview(v_contest,1)
    into v_view;
  if v_view->>'available' <> 'false'
     or v_view->>'ok' <> 'true' then
    raise exception 'Missing private draft was not empty: %',v_view;
  end if;
  select public.novelight_contest_admin_rank_action(
    v_contest,1,'caf00000-0000-4000-8000-000000000099',
    'prepare',null,null,
    'Operator check in disposable integration fixture only'
  ) into v_out;
  if v_out->>'reason' <> 'contest_inactive' then
    raise exception 'Hidden contest permitted rank mutation: %',v_out;
  end if;
  select public.novelight_contest_admin_rank_action(
    v_contest,1,'caf00000-0000-4000-8000-000000000099',
    'publish',null,null,
    'Operator check in disposable integration fixture only'
  ) into v_out;
  if v_out->>'reason' <> 'missing_snapshot_proof' then
    raise exception 'Release request did not require version: %',v_out;
  end if;
  select public.novelight_contest_auto_prepare_rank_slot(v_contest,1)
    into v_out;
  if v_out->>'reason' <> 'outside_prepare_window' then
    raise exception 'Future noon preparation ran today: %',v_out;
  end if;
  if exists (
    select 1 from public.novelight_contest_review_audit
     where action in (
       'operator_rank_prepare','operator_rank_publish','automatic_rank_prepare'
     )
  ) then
    raise exception 'Rejected action wrote a release audit';
  end if;
end
$release_fixture$;
rollback;
select 'PASS: Step 08 admin ranking and dormant cron private, gated and audit-safe' as result;
