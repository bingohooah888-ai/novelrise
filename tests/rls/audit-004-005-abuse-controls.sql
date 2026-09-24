\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email, raw_user_meta_data)
select
  ('94000000-0000-0000-0000-' || pg_catalog.lpad(g::text, 12, '0'))::uuid,
  'audit-abuse-' || g || '@example.invalid',
  pg_catalog.jsonb_build_object('display_name', 'Audit Abuse ' || g)
from pg_catalog.generate_series(1, 10) g
on conflict (id) do nothing;

insert into public.profiles (id, display_name)
select
  ('94000000-0000-0000-0000-' || pg_catalog.lpad(g::text, 12, '0'))::uuid,
  'Audit Abuse ' || g
from pg_catalog.generate_series(1, 10) g
on conflict (id) do update set display_name = excluded.display_name;

insert into public.novel_thumbnail_assets (
  id, label, storage_path, image_url, is_active
)
values (
  '94000000-0000-0000-0000-000000000099',
  'AUDIT-004/005 fixture thumbnail',
  'official/94000000-0000-0000-0000-000000000099.webp',
  'https://example.invalid/audit-004-005.webp',
  true
)
on conflict (id) do nothing;

insert into public.novels (
  id, user_id, title, description, genre, status, pv, ai_usage,
  content_policy_ack, content_policy_version, thumbnail_asset_id
)
overriding system value
select
  940000 + g,
  ('94000000-0000-0000-0000-' || pg_catalog.lpad(g::text, 12, '0'))::uuid,
  'AUDIT-004 fixture ' || g,
  'fixture',
  '現代ファンタジー',
  'draft',
  0,
  'human',
  true,
  'beta-2026-08-23',
  '94000000-0000-0000-0000-000000000099'
from pg_catalog.generate_series(1, 10) g;

set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '94000000-0000-0000-0000-000000000001',
  true
);

do $$
declare
  v_count integer;
begin
  select public.novelight_bulk_import_episode_drafts(
    940001,
    (
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'title', 'Normal ' || g,
          'content', 'body ' || g
        ) order by g
      )
      from pg_catalog.generate_series(1, 100) g
    )
  ) into v_count;

  if v_count <> 100 then
    raise exception 'Normal 100-episode import returned %', v_count;
  end if;
end
$$;

reset role;

do $$
begin
  if (
    select pg_catalog.count(*)
      from public.episodes e
     where e.novel_id = 940001
       and e.status = 'draft'
  ) <> 100 then
    raise exception 'Normal 100-episode import did not remain available';
  end if;

  if not exists (
    select 1
      from public.bulk_import_requests r
     where r.user_id = '94000000-0000-0000-0000-000000000001'
       and r.novel_id = 940001
       and r.episode_count = 100
       and pg_catalog.char_length(r.request_hash) = 64
  ) then
    raise exception 'Successful import did not produce bounded audit evidence';
  end if;
end
$$;

set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '94000000-0000-0000-0000-000000000002',
  true
);

select public.novelight_bulk_import_episode_drafts(
  940002,
  '[{"title":"Replay","content":"same body"}]'::jsonb
);

do $$
begin
  begin
    perform public.novelight_bulk_import_episode_drafts(
      940002,
      '[{"title":"Replay","content":"same body"}]'::jsonb
    );
    raise exception 'Identical 24-hour replay unexpectedly succeeded';
  exception when unique_violation then null;
  end;
end
$$;

do $$
begin
  begin
    perform public.novelight_bulk_import_episode_drafts(
      940003,
      '[{"title":"Wrong owner","content":"body"}]'::jsonb
    );
    raise exception 'Cross-owner import unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end
$$;

reset role;

set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '94000000-0000-0000-0000-000000000003',
  true
);

do $$
begin
  begin
    perform public.novelight_bulk_import_episode_drafts(
      940003,
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'title', 'Oversized ' || g,
            'content', pg_catalog.repeat('あ', 100000)
          ) order by g
        )
        from pg_catalog.generate_series(1, 51) g
      )
    );
    raise exception 'Import above 5,000,000 body characters unexpectedly succeeded';
  exception when invalid_parameter_value then null;
  end;
end
$$;

reset role;

insert into public.episodes (
  novel_id, user_id, episode_number, title, content, status, pv
)
select
  940004,
  '94000000-0000-0000-0000-000000000004',
  g,
  'Draft ' || g,
  'body',
  'draft',
  0
from pg_catalog.generate_series(1, 1999) g;

set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '94000000-0000-0000-0000-000000000004',
  true
);

do $$
begin
  begin
    perform public.novelight_bulk_import_episode_drafts(
      940004,
      '[
        {"title":"Draft 2000","content":"body"},
        {"title":"Draft 2001","content":"body"}
      ]'::jsonb
    );
    raise exception 'Per-novel 2,000-draft cap was bypassed';
  exception when check_violation then null;
  end;
end
$$;

reset role;

set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '94000000-0000-0000-0000-000000000005',
  true
);

do $$
declare
  v_index integer;
begin
  for v_index in 1..5 loop
    perform public.novelight_bulk_import_episode_drafts(
      940005,
      pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'title', 'Rate ' || v_index,
          'content', 'body ' || v_index
        )
      )
    );
  end loop;

  begin
    perform public.novelight_bulk_import_episode_drafts(
      940005,
      '[{"title":"Rate 6","content":"body 6"}]'::jsonb
    );
    raise exception 'Sixth import inside 10 minutes unexpectedly succeeded';
  exception when raise_exception then
    if sqlerrm <> 'Bulk import rate limit exceeded' then
      raise;
    end if;
  end;
end
$$;

reset role;

insert into public.bulk_import_requests (
  user_id, novel_id, import_mode, request_hash,
  episode_count, body_char_count, created_at
)
select
  '94000000-0000-0000-0000-000000000006',
  940006,
  'sequential',
  pg_catalog.lpad(g::text, 64, 'a'),
  190,
  200,
  pg_catalog.now() - interval '20 minutes'
from pg_catalog.generate_series(1, 5) g;

set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '94000000-0000-0000-0000-000000000006',
  true
);

do $$
begin
  begin
    perform public.novelight_bulk_import_episode_drafts(
      940006,
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object('title', 'Daily ' || g, 'content', 'body')
          order by g
        )
        from pg_catalog.generate_series(1, 100) g
      )
    );
    raise exception 'Daily 1,000-episode quota was bypassed';
  exception when raise_exception then
    if sqlerrm <> 'Daily bulk import episode limit exceeded' then
      raise;
    end if;
  end;
end
$$;

reset role;

set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '94000000-0000-0000-0000-000000000007',
  true
);

select public.novelight_import_episode_drafts(
  940007,
  '[{"episode_number":10,"title":"Legacy","content":"legacy body"}]'::jsonb
);

do $$
begin
  begin
    perform * from public.bulk_import_requests;
    raise exception 'Authenticated user unexpectedly read raw import audit rows';
  exception when insufficient_privilege then null;
  end;
end
$$;

reset role;

do $$
begin
  if not exists (
    select 1
      from public.bulk_import_requests r
     where r.user_id = '94000000-0000-0000-0000-000000000007'
       and r.novel_id = 940007
       and r.import_mode = 'numbered'
  ) then
    raise exception 'Legacy import path bypassed the shared abuse controls';
  end if;
end
$$;

set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '94000000-0000-0000-0000-000000000008',
  true
);

select public.novelight_record_bulk_import_event(
  'bulk_import_opened', 940008, 0
);
select public.novelight_record_bulk_import_event(
  'bulk_import_opened', 940008, 0
);

do $$
begin
  perform pg_catalog.set_config(
    'request.jwt.claim.sub',
    '94000000-0000-0000-0000-000000000009',
    true
  );
  begin
    perform public.novelight_record_bulk_import_event(
      'bulk_import_opened', 940008, 0
    );
    raise exception 'Analytics accepted another user''s novel id';
  exception when insufficient_privilege then null;
  end;
end
$$;

reset role;

do $$
begin
  if (
    select pg_catalog.count(*)
      from public.bulk_import_events e
     where e.user_id = '94000000-0000-0000-0000-000000000008'
       and e.novel_id = 940008
       and e.event_name = 'bulk_import_opened'
  ) <> 1 then
    raise exception 'Bulk import analytics 5-minute dedupe failed';
  end if;
end
$$;

insert into public.bulk_import_events (
  user_id, novel_id, event_name, episode_count, created_at
)
select
  '94000000-0000-0000-0000-000000000009',
  940009,
  'bulk_import_parsed',
  g,
  pg_catalog.now() - interval '1 minute'
from pg_catalog.generate_series(1, 30) g;

set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '94000000-0000-0000-0000-000000000009',
  true
);

do $$
begin
  begin
    perform public.novelight_record_bulk_import_event(
      'bulk_import_completed', 940009, 100
    );
    raise exception 'Bulk analytics 10-minute rate limit was bypassed';
  exception when raise_exception then
    if sqlerrm <> 'Bulk import analytics rate limit exceeded' then
      raise;
    end if;
  end;
end
$$;

reset role;

set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '94000000-0000-0000-0000-000000000010',
  true
);

do $$
declare
  v_first boolean;
  v_second boolean;
begin
  select public.novelight_record_scout_record_visit() into v_first;
  select public.novelight_record_scout_record_visit() into v_second;

  if not v_first or v_second then
    raise exception 'SCOUT visit dedupe did not return true then false';
  end if;
end
$$;

reset role;

do $$
begin
  if (
    select d.visit_count
      from public.scout_record_usage_days d
     where d.user_id = '94000000-0000-0000-0000-000000000010'
       and d.activity_date = pg_catalog.timezone('Asia/Tokyo', pg_catalog.now())::date
  ) <> 1 then
    raise exception 'SCOUT duplicate visit inflated visit_count';
  end if;
end
$$;

update public.novels
   set status = 'published'
 where id = 940010;

insert into public.episodes (
  novel_id, user_id, episode_number, title, content, status, pv
) values (
  940010,
  '94000000-0000-0000-0000-000000000010',
  1,
  'AUDIT-005 published episode',
  'published analytics fixture',
  'published',
  0
);

set local role anon;

do $$
begin
  begin
    perform public.record_beta_visit('direct-anon-token', '/audit', 'direct');
    raise exception 'Anonymous caller executed record_beta_visit directly';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.record_acquisition_touch(
      'direct-anon-token', 'x', null, null, null, '/audit', null
    );
    raise exception 'Anonymous caller executed record_acquisition_touch directly';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.record_reader_journey_event(
      'detail_open', '940010', null, 'direct-anon-token', 'direct'
    );
    raise exception 'Anonymous caller executed record_reader_journey_event directly';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.record_episode_pv(
      (select e.id::text from public.episodes e where e.novel_id = 940010),
      'direct-anon-token'
    );
    raise exception 'Anonymous caller executed record_episode_pv directly';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.record_neutral_search_impressions(
      array['940010'], 'direct-anon-token'
    );
    raise exception 'Anonymous caller executed record_neutral_search_impressions directly';
  exception when insufficient_privilege then null;
  end;
end
$$;

reset role;
select pg_catalog.set_config('request.jwt.claim.sub', '', true);
set local role service_role;

do $$
declare
  v_first boolean;
  v_second boolean;
  v_touch_a uuid;
  v_touch_b uuid;
  v_journey_a boolean;
  v_journey_b boolean;
  v_pv_a boolean;
  v_pv_b boolean;
  v_search_a integer;
  v_search_b integer;
  v_episode_id text;
begin
  select public.record_beta_visit('audit-beta-token', '/audit', 'direct') into v_first;
  select public.record_beta_visit('audit-beta-token', '/audit', 'direct') into v_second;
  if not v_first or v_second then
    raise exception 'Beta visit dedupe did not return true then false';
  end if;

  select public.record_acquisition_touch(
    'audit-acquisition-token', 'x', 'social', 'beta', 'post', '/audit', 'x.com'
  ) into v_touch_a;
  select public.record_acquisition_touch(
    'audit-acquisition-token', 'x', 'social', 'beta', 'post', '/audit', 'x.com'
  ) into v_touch_b;

  if v_touch_a <> v_touch_b then
    raise exception 'Acquisition dedupe did not return the original event id';
  end if;

  select e.id::text into v_episode_id
    from public.episodes e
   where e.novel_id = 940010;

  select public.record_reader_journey_event(
    'detail_open', '940010', null, 'audit-journey-token', 'direct'
  ) into v_journey_a;
  select public.record_reader_journey_event(
    'detail_open', '940010', null, 'audit-journey-token', 'direct'
  ) into v_journey_b;
  if not v_journey_a or v_journey_b then
    raise exception 'Reader journey dedupe did not return true then false';
  end if;

  select public.record_episode_pv(v_episode_id, 'audit-pv-token') into v_pv_a;
  select public.record_episode_pv(v_episode_id, 'audit-pv-token') into v_pv_b;
  if not v_pv_a or v_pv_b then
    raise exception 'Episode PV dedupe did not return true then false';
  end if;

  select public.record_neutral_search_impressions(
    array['940010'], 'audit-search-token'
  ) into v_search_a;
  select public.record_neutral_search_impressions(
    array['940010'], 'audit-search-token'
  ) into v_search_b;
  if v_search_a <> 1 or v_search_b <> 0 then
    raise exception 'Neutral search dedupe did not return one row then zero rows';
  end if;
end
$$;

reset role;

do $$
begin
  if (
    select pg_catalog.count(*)
      from public.acquisition_touches t
     where t.visitor_key_hash = pg_catalog.md5('audit-acquisition-token')
  ) <> 1 then
    raise exception 'Acquisition duplicate created an extra analytics row';
  end if;

  if (
    select d.visit_count
      from public.beta_activity_days d
     where d.viewer_key_hash = pg_catalog.md5('visitor:audit-beta-token')
       and d.activity_date = pg_catalog.timezone('Asia/Tokyo', pg_catalog.now())::date
  ) <> 1 then
    raise exception 'Beta visit duplicate inflated visit_count';
  end if;
end
$$;

insert into public.reader_journey_events (
  viewer_key_hash, event_type, novel_id_snapshot, source, occurred_at, event_hour
)
select
  pg_catalog.md5('visitor:audit-journey-rate-token'),
  'detail_open',
  'seed-' || g,
  'direct',
  pg_catalog.now() - interval '1 minute',
  pg_catalog.date_trunc('hour', pg_catalog.now())
from pg_catalog.generate_series(1, 120) g;

insert into public.episode_pv_events (
  viewer_key_hash, episode_id_snapshot, novel_id_snapshot, counted_at
)
select
  pg_catalog.md5('visitor:audit-pv-rate-token'),
  'seed-episode-' || g,
  'seed-novel',
  pg_catalog.now() - interval '1 minute'
from pg_catalog.generate_series(1, 120) g;

insert into public.neutral_search_impression_telemetry (
  viewer_key, novel_id_snapshot, exposed_at, exposure_hour
)
select
  'visitor:audit-search-rate-token',
  'seed-' || g,
  pg_catalog.now() - interval '1 minute',
  pg_catalog.date_trunc('hour', pg_catalog.now())
from pg_catalog.generate_series(1, 200) g;

set local role service_role;
do $$
declare
  v_episode_id text;
begin
  select e.id::text into v_episode_id
    from public.episodes e
   where e.novel_id = 940010;

  begin
    perform public.record_reader_journey_event(
      'episode_read_10s', '940010', v_episode_id, 'audit-journey-rate-token', 'direct'
    );
    raise exception 'Reader journey hourly rate limit was bypassed';
  exception when raise_exception then
    if sqlerrm <> 'Reader journey hourly limit exceeded' then raise; end if;
  end;

  begin
    perform public.record_episode_pv(v_episode_id, 'audit-pv-rate-token');
    raise exception 'Episode PV hourly rate limit was bypassed';
  exception when raise_exception then
    if sqlerrm <> 'Episode PV hourly limit exceeded' then raise; end if;
  end;

  begin
    perform public.record_neutral_search_impressions(
      array['940010'], 'audit-search-rate-token'
    );
    raise exception 'Neutral search hourly rate limit was bypassed';
  exception when raise_exception then
    if sqlerrm <> 'Neutral search hourly limit exceeded' then raise; end if;
  end;
end
$$;

reset role;

insert into public.acquisition_touches (
  visitor_key_hash, source, landing_path, touched_at
)
select
  pg_catalog.md5('audit-acquisition-rate-token'),
  'seed-' || g,
  '/seed-' || g,
  pg_catalog.now() - interval '1 minute'
from pg_catalog.generate_series(1, 10) g;

set local role service_role;
do $$
begin
  begin
    perform public.record_acquisition_touch(
      'audit-acquisition-rate-token',
      'new-source',
      null,
      null,
      null,
      '/new',
      null
    );
    raise exception 'Acquisition hourly rate limit was bypassed';
  exception when raise_exception then
    if sqlerrm <> 'Too many acquisition events' then
      raise;
    end if;
  end;
end
$$;

reset role;
select pg_catalog.set_config('request.jwt.claim.sub', '', true);

rollback;
