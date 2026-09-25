begin;

do $$
declare
  v_import_def text;
begin
  if not exists (
    select 1
      from supabase_migrations.schema_migrations
     where version = '20260924091509'
  ) then
    raise exception 'AUDIT-004/005 Production migration is not recorded';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.bulk_import_requests'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.bulk_import_events'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.neutral_search_impression_telemetry'::regclass) then
    raise exception 'AUDIT-004/005 RLS is not enabled';
  end if;

  if has_table_privilege('authenticated', 'public.bulk_import_requests', 'select')
     or has_table_privilege('anon', 'public.bulk_import_requests', 'select') then
    raise exception 'Raw bulk import ledger is exposed';
  end if;

  if has_function_privilege(
       'anon',
       'public.novelight_bulk_import_episode_drafts(bigint,jsonb)',
       'execute'
     )
     or not has_function_privilege(
       'authenticated',
       'public.novelight_bulk_import_episode_drafts(bigint,jsonb)',
       'execute'
     ) then
    raise exception 'Bulk import RPC grants are incorrect';
  end if;

  if has_function_privilege(
       'anon',
       'public.record_reader_journey_event(text,text,text,text,text)',
       'execute'
     )
     or has_function_privilege(
       'anon',
       'public.record_episode_pv(text,text)',
       'execute'
     )
     or has_function_privilege(
       'anon',
       'public.record_neutral_search_impressions(text[],text)',
       'execute'
     ) then
    raise exception 'Anonymous analytics direct-RPC bypass is available';
  end if;

  v_import_def := pg_get_functiondef(
    'public.novelight_bulk_import_episode_drafts(bigint,jsonb)'::regprocedure
  );
  if position('> 20000000' in v_import_def) = 0
     or position('v_count > 100' in v_import_def) = 0
     or position('v_body_char_count > 5000000' in v_import_def) = 0
     or position('char_length(v_content) > 100000' in v_import_def) = 0 then
    raise exception 'Production bulk import payload limits drifted';
  end if;
end
$$;

do $$
declare
  v_day_start timestamptz := timezone(
    'Asia/Tokyo',
    (timezone('Asia/Tokyo', now())::date)::timestamp without time zone
  );
begin
  if now() < v_day_start + interval '61 minutes' then
    raise exception 'Daily quota smoke requires one elapsed JST hour';
  end if;
end
$$;

insert into auth.users (id, email, raw_user_meta_data)
select
  ('95100000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid,
  'production-audit-smoke-' || g || '@example.invalid',
  jsonb_build_object('display_name', 'Production Audit Smoke ' || g)
from generate_series(1, 12) g;

insert into public.profiles (id, display_name)
select
  ('95100000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid,
  'Production Audit Smoke ' || g
from generate_series(1, 12) g
on conflict (id) do update set display_name = excluded.display_name;

insert into public.novels (
  id, user_id, title, description, genre, status, pv, ai_usage,
  content_policy_ack, content_policy_version
)
overriding system value
select
  951000 + g,
  ('95100000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid,
  'Production AUDIT-004/005 transaction smoke ' || g,
  'Transaction-scoped fixture',
  '現代ファンタジー',
  case when g = 10 then 'published' else 'draft' end,
  0,
  'human',
  true,
  'beta-2026-08-23'
from generate_series(1, 12) g;

insert into public.episodes (
  novel_id, user_id, episode_number, title, content, status, pv
) values (
  951010,
  '95100000-0000-0000-0000-000000000010',
  1,
  'Production analytics transaction smoke',
  'Published transaction fixture',
  'published',
  0
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '95100000-0000-0000-0000-000000000001',
  true
);

do $$
begin
  begin
    perform public.novelight_bulk_import_episode_drafts(
      951001,
      (
        select jsonb_agg(
          jsonb_build_object(
            'title', 'Body total ' || g,
            'content', repeat('あ', 100000)
          ) order by g
        )
        from generate_series(1, 51) g
      )
    );
    raise exception '5,000,000-character import cap was bypassed';
  exception when invalid_parameter_value then null;
  end;
end
$$;

reset role;

insert into public.episodes (
  novel_id, user_id, episode_number, title, content, status, pv
)
select
  951002,
  '95100000-0000-0000-0000-000000000002',
  g,
  'Draft ' || g,
  'body',
  'draft',
  0
from generate_series(1, 1999) g;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '95100000-0000-0000-0000-000000000002',
  true
);

do $$
begin
  begin
    perform public.novelight_bulk_import_episode_drafts(
      951002,
      '[{"title":"Draft 2000","content":"body"},{"title":"Draft 2001","content":"body"}]'::jsonb
    );
    raise exception 'Per-novel 2,000-draft cap was bypassed';
  exception when check_violation then
    if sqlerrm <> 'Novel draft episode limit exceeded' then raise; end if;
  end;
end
$$;

reset role;

insert into public.bulk_import_requests (
  user_id, novel_id, import_mode, request_hash,
  episode_count, body_char_count, created_at
)
select
  '95100000-0000-0000-0000-000000000003',
  951003,
  'sequential',
  encode(extensions.digest('daily-request-' || g, 'sha256'), 'hex'),
  1,
  1,
  timezone(
    'Asia/Tokyo',
    (timezone('Asia/Tokyo', now())::date)::timestamp without time zone
  ) + interval '1 minute'
from generate_series(1, 20) g;

insert into public.bulk_import_requests (
  user_id, novel_id, import_mode, request_hash,
  episode_count, body_char_count, created_at
)
select
  '95100000-0000-0000-0000-000000000004',
  951004,
  'sequential',
  encode(extensions.digest('daily-episode-' || g, 'sha256'), 'hex'),
  200,
  1,
  timezone(
    'Asia/Tokyo',
    (timezone('Asia/Tokyo', now())::date)::timestamp without time zone
  ) + interval '1 minute'
from generate_series(1, 5) g;

insert into public.bulk_import_requests (
  user_id, novel_id, import_mode, request_hash,
  episode_count, body_char_count, created_at
)
select
  '95100000-0000-0000-0000-000000000005',
  951005,
  'sequential',
  encode(extensions.digest('daily-text-' || g, 'sha256'), 'hex'),
  1,
  5000000,
  timezone(
    'Asia/Tokyo',
    (timezone('Asia/Tokyo', now())::date)::timestamp without time zone
  ) + interval '1 minute'
from generate_series(1, 4) g;

set local role authenticated;

select set_config('request.jwt.claim.sub', '95100000-0000-0000-0000-000000000003', true);
do $$
begin
  begin
    perform public.novelight_bulk_import_episode_drafts(
      951003, '[{"title":"Daily request","content":"body"}]'::jsonb
    );
    raise exception 'Daily 20-request quota was bypassed';
  exception when raise_exception then
    if sqlerrm <> 'Daily bulk import request limit exceeded' then raise; end if;
  end;
end
$$;

select set_config('request.jwt.claim.sub', '95100000-0000-0000-0000-000000000004', true);
do $$
begin
  begin
    perform public.novelight_bulk_import_episode_drafts(
      951004, '[{"title":"Daily episode","content":"body"}]'::jsonb
    );
    raise exception 'Daily 1,000-episode quota was bypassed';
  exception when raise_exception then
    if sqlerrm <> 'Daily bulk import episode limit exceeded' then raise; end if;
  end;
end
$$;

select set_config('request.jwt.claim.sub', '95100000-0000-0000-0000-000000000005', true);
do $$
begin
  begin
    perform public.novelight_bulk_import_episode_drafts(
      951005, '[{"title":"Daily text","content":"body"}]'::jsonb
    );
    raise exception 'Daily 20,000,000-character quota was bypassed';
  exception when raise_exception then
    if sqlerrm <> 'Daily bulk import character limit exceeded' then raise; end if;
  end;
end
$$;

reset role;

insert into public.bulk_import_events (
  user_id, novel_id, event_name, episode_count, created_at
)
select
  '95100000-0000-0000-0000-000000000006',
  951006,
  'bulk_import_parsed',
  g % 101,
  timezone(
    'Asia/Tokyo',
    (timezone('Asia/Tokyo', now())::date)::timestamp without time zone
  ) + interval '1 minute'
from generate_series(1, 200) g;

set local role authenticated;
select set_config('request.jwt.claim.sub', '95100000-0000-0000-0000-000000000006', true);
do $$
begin
  begin
    perform public.novelight_record_bulk_import_event(
      'bulk_import_completed', 951006, 100
    );
    raise exception 'Daily bulk analytics limit was bypassed';
  exception when raise_exception then
    if sqlerrm <> 'Daily bulk import analytics limit exceeded' then raise; end if;
  end;
end
$$;

reset role;

insert into public.scout_record_usage_days (
  user_id, activity_date, first_seen_at, last_seen_at, visit_count
) values (
  '95100000-0000-0000-0000-000000000007',
  timezone('Asia/Tokyo', now())::date,
  timezone(
    'Asia/Tokyo',
    (timezone('Asia/Tokyo', now())::date)::timestamp without time zone
  ) + interval '1 minute',
  timezone(
    'Asia/Tokyo',
    (timezone('Asia/Tokyo', now())::date)::timestamp without time zone
  ) + interval '1 minute',
  48
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '95100000-0000-0000-0000-000000000007', true);
do $$
begin
  if public.novelight_record_scout_record_visit() then
    raise exception 'SCOUT daily visit limit was bypassed';
  end if;
end
$$;

reset role;
select set_config('request.jwt.claim.sub', '', true);

insert into public.beta_activity_days (
  viewer_key_hash, activity_date, first_seen_at, last_seen_at,
  visit_count, first_path, latest_path, source
) values (
  md5('visitor:production-beta-daily-token'),
  timezone('Asia/Tokyo', now())::date,
  timezone(
    'Asia/Tokyo',
    (timezone('Asia/Tokyo', now())::date)::timestamp without time zone
  ) + interval '1 minute',
  timezone(
    'Asia/Tokyo',
    (timezone('Asia/Tokyo', now())::date)::timestamp without time zone
  ) + interval '1 minute',
  48,
  '/transaction-smoke',
  '/transaction-smoke',
  'audit-smoke'
);

insert into public.acquisition_touches (
  visitor_key_hash, source, landing_path, touched_at
)
select
  md5('production-acquisition-daily-token'),
  'daily-' || g,
  '/daily-' || g,
  timezone(
    'Asia/Tokyo',
    (timezone('Asia/Tokyo', now())::date)::timestamp without time zone
  ) + interval '1 minute'
from generate_series(1, 50) g;

insert into public.reader_journey_events (
  viewer_key_hash, event_type, novel_id_snapshot, source,
  occurred_at, event_hour
)
select
  md5('visitor:production-journey-daily-token'),
  'detail_open',
  'daily-seed-' || g,
  'audit-smoke',
  timezone(
    'Asia/Tokyo',
    (timezone('Asia/Tokyo', now())::date)::timestamp without time zone
  ) + interval '1 minute',
  date_trunc(
    'hour',
    timezone(
      'Asia/Tokyo',
      (timezone('Asia/Tokyo', now())::date)::timestamp without time zone
    ) + interval '1 minute'
  )
from generate_series(1, 1000) g;

insert into public.episode_pv_events (
  viewer_key_hash, episode_id_snapshot, novel_id_snapshot, counted_at
)
select
  md5('visitor:production-pv-daily-token'),
  'daily-episode-' || g,
  'daily-novel',
  timezone(
    'Asia/Tokyo',
    (timezone('Asia/Tokyo', now())::date)::timestamp without time zone
  ) + interval '1 minute'
from generate_series(1, 500) g;

insert into public.neutral_search_impression_telemetry (
  viewer_key, novel_id_snapshot, exposed_at, exposure_hour
)
select
  'visitor:production-search-daily-token',
  'daily-novel-' || g,
  timezone(
    'Asia/Tokyo',
    (timezone('Asia/Tokyo', now())::date)::timestamp without time zone
  ) + interval '1 minute',
  date_trunc(
    'hour',
    timezone(
      'Asia/Tokyo',
      (timezone('Asia/Tokyo', now())::date)::timestamp without time zone
    ) + interval '1 minute'
  )
from generate_series(1, 2000) g;

set local role service_role;

do $$
declare
  v_episode_id text := (
    select id::text from public.episodes where novel_id = 951010 limit 1
  );
begin
  if public.record_beta_visit(
    'production-beta-daily-token', '/transaction-smoke', 'audit-smoke'
  ) then
    raise exception 'Beta visit daily limit was bypassed';
  end if;

  begin
    perform public.record_acquisition_touch(
      'production-acquisition-daily-token',
      'daily-new',
      null,
      null,
      null,
      '/daily-new',
      null
    );
    raise exception 'Acquisition daily limit was bypassed';
  exception when raise_exception then
    if sqlerrm <> 'Daily acquisition event limit exceeded' then raise; end if;
  end;

  begin
    perform public.record_reader_journey_event(
      'detail_open',
      '951010',
      null,
      'production-journey-daily-token',
      'audit-smoke'
    );
    raise exception 'Reader journey daily limit was bypassed';
  exception when raise_exception then
    if sqlerrm <> 'Reader journey daily limit exceeded' then raise; end if;
  end;

  begin
    perform public.record_episode_pv(
      v_episode_id,
      'production-pv-daily-token'
    );
    raise exception 'Episode PV daily limit was bypassed';
  exception when raise_exception then
    if sqlerrm <> 'Episode PV daily limit exceeded' then raise; end if;
  end;

  begin
    perform public.record_neutral_search_impressions(
      array['951010'],
      'production-search-daily-token'
    );
    raise exception 'Neutral search daily limit was bypassed';
  exception when raise_exception then
    if sqlerrm <> 'Neutral search daily limit exceeded' then raise; end if;
  end;
end
$$;

reset role;

set local role anon;
do $$
begin
  begin
    perform public.record_beta_visit('direct-anon-token', '/', 'direct');
    raise exception 'Anonymous direct beta visit RPC unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.record_acquisition_touch(
      'direct-anon-token', 'direct', null, null, null, '/', null
    );
    raise exception 'Anonymous direct acquisition RPC unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end
$$;

rollback;

select
  'PASS' as result,
  not exists (
    select 1 from public.profiles
     where id::text like '95100000-0000-0000-0000-%'
  ) as transaction_fixture_rolled_back,
  not exists (
    select 1 from public.novels where id between 951001 and 951012
  ) as transaction_content_rolled_back;
