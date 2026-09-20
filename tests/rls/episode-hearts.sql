begin;

insert into auth.users (id, raw_user_meta_data)
values
  ('82000000-0000-0000-0000-000000000001', '{"display_name":"Heart Author"}'::jsonb),
  ('82000000-0000-0000-0000-000000000002', '{"display_name":"Heart Reader"}'::jsonb),
  ('82000000-0000-0000-0000-000000000003', '{"display_name":"Heart Reader 2"}'::jsonb)
on conflict (id) do nothing;

insert into public.profiles (id, display_name)
values
  ('82000000-0000-0000-0000-000000000001', 'Heart Author'),
  ('82000000-0000-0000-0000-000000000002', 'Heart Reader'),
  ('82000000-0000-0000-0000-000000000003', 'Heart Reader 2')
on conflict (id) do update set display_name = excluded.display_name;

insert into public.novel_thumbnail_assets (
  id, label, storage_path, image_url, created_by
)
values (
  '82000000-0000-0000-0000-000000000010',
  'Episode heart fixture thumbnail',
  'official/82000000-0000-0000-0000-000000000010.webp',
  'https://example.invalid/episode-heart-fixture.webp',
  '82000000-0000-0000-0000-000000000001'
)
on conflict (id) do nothing;
insert into public.novels (
  id, user_id, title, description, genre, status, pv, ai_usage,
  content_policy_ack, content_policy_version, thumbnail_asset_id
)
overriding system value
values
  (
    820001, '82000000-0000-0000-0000-000000000001',
    'Episode Heart Public Work', 'fixture', 'ファンタジー', 'published', 0, 'human',
    true, 'beta-v1', '82000000-0000-0000-0000-000000000010'
  ),
  (
    820002, '82000000-0000-0000-0000-000000000001',
    'Episode Heart Draft Work', 'fixture', 'ファンタジー', 'draft', 0, 'human',
    true, 'beta-v1', '82000000-0000-0000-0000-000000000010'
  );

insert into public.episodes (
  id, novel_id, user_id, episode_number, title, content, status, pv
)
overriding system value
values
  (
    820001, 820001, '82000000-0000-0000-0000-000000000001',
    1, 'Public episode', 'body', 'published', 0
  ),
  (
    820002, 820002, '82000000-0000-0000-0000-000000000001',
    1, 'Draft episode', 'body', 'draft', 0
  );
set local role anon;
do $$
declare
  v_state jsonb;
begin
  v_state := public.novelight_episode_heart_state(820001);
  if not (v_state ->> 'available')::boolean
     or (v_state ->> 'hearted')::boolean
     or (v_state ->> 'can_heart')::boolean
     or (v_state ->> 'heart_count')::bigint <> 0
     or v_state ? 'user_id' then
    raise exception 'Anonymous episode heart state is incorrect';
  end if;

  begin
    perform public.novelight_toggle_episode_heart(820001);
    raise exception 'Anon unexpectedly executed episode-heart toggle';
  exception when insufficient_privilege then null;
  end;
end
$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '82000000-0000-0000-0000-000000000002', true);

do $$
declare
  v_state jsonb;
begin
  v_state := public.novelight_episode_heart_state(820001);
  if not (v_state ->> 'can_heart')::boolean
     or (v_state ->> 'hearted')::boolean
     or (v_state ->> 'heart_count')::bigint <> 0 then
    raise exception 'Authenticated pre-heart state is incorrect';
  end if;
  begin
    perform * from public.episode_hearts;
    raise exception 'Raw episode_hearts unexpectedly readable';
  exception when insufficient_privilege then null;
  end;
end
$$;

do $$
declare
  v_result jsonb;
begin
  v_result := public.novelight_toggle_episode_heart(820001);
  if not (v_result ->> 'hearted')::boolean
     or (v_result ->> 'heart_count')::bigint <> 1 then
    raise exception 'Episode heart insert toggle failed';
  end if;

  v_result := public.novelight_episode_heart_state(820001);
  if not (v_result ->> 'hearted')::boolean
     or (v_result ->> 'heart_count')::bigint <> 1 then
    raise exception 'Episode heart state did not reflect insert';
  end if;

  v_result := public.novelight_toggle_episode_heart(820001);
  if (v_result ->> 'hearted')::boolean
     or (v_result ->> 'heart_count')::bigint <> 0 then
    raise exception 'Episode heart removal toggle failed';
  end if;
end
$$;

do $$
begin
  begin
    perform public.novelight_toggle_episode_heart(820002);
    raise exception 'Heart on draft episode unexpectedly succeeded';
  exception when check_violation then null;
  end;
end
$$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '82000000-0000-0000-0000-000000000001', true);
do $$
begin
  begin
    perform public.novelight_toggle_episode_heart(820001);
    raise exception 'Author self-heart unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end
$$;
reset role;
select set_config('request.jwt.claim.sub', '', true);

insert into public.user_blocks(blocker_user_id, blocked_user_id)
values (
  '82000000-0000-0000-0000-000000000001',
  '82000000-0000-0000-0000-000000000002'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '82000000-0000-0000-0000-000000000002', true);
do $$
declare
  v_state jsonb;
begin
  v_state := public.novelight_episode_heart_state(820001);
  if (v_state ->> 'can_heart')::boolean then
    raise exception 'Blocked reader retained episode-heart eligibility';
  end if;

  begin
    perform public.novelight_toggle_episode_heart(820001);
    raise exception 'Blocked reader unexpectedly sent episode heart';
  exception when insufficient_privilege then null;
  end;
end
$$;
reset role;
select set_config('request.jwt.claim.sub', '', true);

rollback;
