\set ON_ERROR_STOP on

begin;

insert into auth.users (id, raw_user_meta_data)
values
  ('79700000-0000-0000-0000-000000000001', '{"display_name":"B17 Author"}'::jsonb),
  ('79700000-0000-0000-0000-000000000002', '{"display_name":"B17 Reader"}'::jsonb),
  ('79700000-0000-0000-0000-000000000003', '{"display_name":"B17 Other"}'::jsonb)
on conflict (id) do nothing;

insert into public.profiles (id, display_name)
values
  ('79700000-0000-0000-0000-000000000001', 'B17 Author'),
  ('79700000-0000-0000-0000-000000000002', 'B17 Reader'),
  ('79700000-0000-0000-0000-000000000003', 'B17 Other')
on conflict (id) do update set display_name = excluded.display_name;

insert into public.novel_thumbnail_assets (
  id, label, storage_path, image_url, created_by
)
values (
  '79700000-0000-0000-0000-000000000010',
  'B17 fixture thumbnail',
  'official/79700000-0000-0000-0000-000000000010.webp',
  'https://example.invalid/b17-fixture.webp',
  '79700000-0000-0000-0000-000000000001'
)
on conflict (id) do nothing;

insert into public.novels (
  id, user_id, title, description, genre, status, pv, ai_usage,
  content_policy_ack, content_policy_version, thumbnail_asset_id
)
overriding system value
values
  (
    797001, '79700000-0000-0000-0000-000000000001',
    'B17 Fantasy One', 'fixture', 'ファンタジー', 'published', 0, 'human',
    true, 'beta-v1', '79700000-0000-0000-0000-000000000010'
  ),
  (
    797002, '79700000-0000-0000-0000-000000000001',
    'B17 Fantasy Two', 'fixture', 'ファンタジー', 'published', 0, 'human',
    true, 'beta-v1', '79700000-0000-0000-0000-000000000010'
  ),
  (
    797003, '79700000-0000-0000-0000-000000000001',
    'B17 Mystery', 'fixture', 'ミステリー', 'published', 0, 'human',
    true, 'beta-v1', '79700000-0000-0000-0000-000000000010'
  ),
  (
    797004, '79700000-0000-0000-0000-000000000001',
    'B17 Hidden Draft', 'fixture', 'ホラー', 'draft', 0, 'human',
    true, 'beta-v1', '79700000-0000-0000-0000-000000000010'
  );

insert into public.episodes (
  id, novel_id, user_id, episode_number, title, content, status, pv
)
overriding system value
values
  (797011, 797001, '79700000-0000-0000-0000-000000000001', 1, 'F1-1', '本文', 'published', 0),
  (797012, 797001, '79700000-0000-0000-0000-000000000001', 2, 'F1-2', '本文', 'published', 0),
  (797021, 797002, '79700000-0000-0000-0000-000000000001', 1, 'F2-1', '本文', 'published', 0),
  (797031, 797003, '79700000-0000-0000-0000-000000000001', 1, 'M-1', '本文', 'published', 0),
  (797041, 797004, '79700000-0000-0000-0000-000000000001', 1, 'D-1', '本文', 'draft', 0);

insert into public.valid_read_events (
  reader_id, novel_id_snapshot, episode_id_snapshot, author_id_snapshot,
  session_id, qualified_at, body_char_count, progress_signal,
  foreground_signal, interaction_signal, rule_version
)
values
  (
    '79700000-0000-0000-0000-000000000002', '797001', '797011',
    '79700000-0000-0000-0000-000000000001',
    '79710000-0000-0000-0000-000000000011',
    '2026-09-16T14:30:00Z', 1000, true, true, false, 'b17-fixture'
  ),
  (
    '79700000-0000-0000-0000-000000000002', '797001', '797012',
    '79700000-0000-0000-0000-000000000001',
    '79710000-0000-0000-0000-000000000012',
    '2026-09-16T16:30:00Z', 1000, true, true, false, 'b17-fixture'
  ),
  (
    '79700000-0000-0000-0000-000000000002', '797002', '797021',
    '79700000-0000-0000-0000-000000000001',
    '79710000-0000-0000-0000-000000000021',
    '2026-09-17T03:00:00Z', 1000, true, true, false, 'b17-fixture'
  ),
  (
    '79700000-0000-0000-0000-000000000002', '797003', '797031',
    '79700000-0000-0000-0000-000000000001',
    '79710000-0000-0000-0000-000000000031',
    '2026-09-18T03:00:00Z', 1000, true, true, false, 'b17-fixture'
  ),
  (
    '79700000-0000-0000-0000-000000000002', '797004', '797041',
    '79700000-0000-0000-0000-000000000001',
    '79710000-0000-0000-0000-000000000041',
    '2026-09-18T04:00:00Z', 1000, true, true, false, 'b17-fixture'
  ),
  (
    '79700000-0000-0000-0000-000000000003', '797003', '797031',
    '79700000-0000-0000-0000-000000000001',
    '79710000-0000-0000-0000-000000000099',
    '2026-09-18T05:00:00Z', 1000, true, true, false, 'b17-fixture'
  );

insert into public.reader_bookshelf_entries (
  user_id, novel_id, reading_state, list_name, memo
)
values
  (
    '79700000-0000-0000-0000-000000000002',
    797001, 'completed', null, ''
  ),
  (
    '79700000-0000-0000-0000-000000000002',
    797002, 'reading', null, ''
  ),
  (
    '79700000-0000-0000-0000-000000000003',
    797003, 'completed', null, ''
  );

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '79700000-0000-0000-0000-000000000002',
  true
);

do $$
declare
  v_data jsonb;
  v_summary jsonb;
  v_history jsonb;
  v_genres jsonb;
begin
  v_data := public.novelight_reader_history_stats(50);
  v_summary := v_data -> 'summary';
  v_history := v_data -> 'history';
  v_genres := v_data -> 'genres';

  if (v_summary ->> 'valid_read_episode_count')::bigint <> 5 then
    raise exception 'B #17 valid-read episode count is incorrect';
  end if;

  if (v_summary ->> 'valid_read_work_count')::bigint <> 4 then
    raise exception 'B #17 valid-read work count is incorrect';
  end if;

  if (v_summary ->> 'first_valid_read_day_count')::bigint <> 3 then
    raise exception 'B #17 Asia/Tokyo reading-day count is incorrect';
  end if;

  if (v_summary ->> 'completed_marked_work_count')::bigint <> 1 then
    raise exception 'B #17 completed-marked count is incorrect';
  end if;

  if pg_catalog.jsonb_array_length(v_history) <> 4 then
    raise exception 'B #17 public history must omit draft content';
  end if;

  if exists (
    select 1
      from pg_catalog.jsonb_array_elements(v_history) h
     where h ->> 'novel_title' = 'B17 Hidden Draft'
  ) then
    raise exception 'B #17 leaked draft content into reader history';
  end if;

  if not exists (
    select 1
      from pg_catalog.jsonb_array_elements(v_genres) g
     where g ->> 'genre' = 'ファンタジー'
       and (g ->> 'work_count')::bigint = 2
  ) then
    raise exception 'B #17 genre tendency must count distinct works';
  end if;

  if exists (
    select 1
      from pg_catalog.jsonb_array_elements(v_genres) g
     where g ->> 'genre' = 'ホラー'
  ) then
    raise exception 'B #17 genre tendency leaked draft work';
  end if;

  if v_data #>> '{semantics,history_kind}' <> 'first_valid_read_per_episode'
     or (v_data #>> '{semantics,public_profile}')::boolean is not false then
    raise exception 'B #17 response semantics are incorrect';
  end if;
end
$$;

reset role;
select set_config('request.jwt.claim.sub', '', true);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '79700000-0000-0000-0000-000000000003',
  true
);

do $$
declare
  v_data jsonb;
begin
  v_data := public.novelight_reader_history_stats(50);

  if (v_data #>> '{summary,valid_read_episode_count}')::bigint <> 1
     or (v_data #>> '{summary,completed_marked_work_count}')::bigint <> 1 then
    raise exception 'B #17 mixed another reader into private stats';
  end if;
end
$$;

reset role;
select set_config('request.jwt.claim.sub', '', true);

set local role anon;
do $$
begin
  begin
    perform public.novelight_reader_history_stats(50);
    raise exception 'Anonymous reader unexpectedly executed private history RPC';
  exception
    when insufficient_privilege then null;
  end;
end
$$;
reset role;

rollback;
