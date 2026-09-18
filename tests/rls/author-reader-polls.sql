\set ON_ERROR_STOP on

begin;

insert into auth.users (id, raw_user_meta_data)
values
  ('79400000-0000-0000-0000-000000000001', '{"display_name":"B20 Author A"}'::jsonb),
  ('79400000-0000-0000-0000-000000000002', '{"display_name":"B20 Author B"}'::jsonb),
  ('79400000-0000-0000-0000-000000000003', '{"display_name":"B20 Reader"}'::jsonb),
  ('79400000-0000-0000-0000-000000000004', '{"display_name":"B20 Reader 2"}'::jsonb)
on conflict (id) do nothing;

insert into public.profiles (id, display_name)
values
  ('79400000-0000-0000-0000-000000000001', 'B20 Author A'),
  ('79400000-0000-0000-0000-000000000002', 'B20 Author B'),
  ('79400000-0000-0000-0000-000000000003', 'B20 Reader'),
  ('79400000-0000-0000-0000-000000000004', 'B20 Reader 2')
on conflict (id) do update set display_name = excluded.display_name;

insert into public.novel_thumbnail_assets (
  id, label, storage_path, image_url, created_by
)
values (
  '79400000-0000-0000-0000-000000000010',
  'B20 fixture thumbnail',
  'official/79400000-0000-0000-0000-000000000010.webp',
  'https://example.invalid/b20-fixture.webp',
  '79400000-0000-0000-0000-000000000001'
)
on conflict (id) do nothing;

insert into public.novels (
  id, user_id, title, description, genre, status, pv, ai_usage,
  content_policy_ack, content_policy_version, thumbnail_asset_id
)
overriding system value
values
  (
    794001, '79400000-0000-0000-0000-000000000001',
    'B20 Public Work', 'fixture', 'ファンタジー', 'published', 0, 'human',
    true, 'beta-v1', '79400000-0000-0000-0000-000000000010'
  ),
  (
    794002, '79400000-0000-0000-0000-000000000001',
    'B20 Draft Work', 'fixture', 'ファンタジー', 'draft', 0, 'human',
    true, 'beta-v1', '79400000-0000-0000-0000-000000000010'
  ),
  (
    794003, '79400000-0000-0000-0000-000000000002',
    'B20 Other Work', 'fixture', 'ミステリー', 'published', 0, 'human',
    true, 'beta-v1', '79400000-0000-0000-0000-000000000010'
  );

set local role authenticated;
select set_config('request.jwt.claim.sub', '79400000-0000-0000-0000-000000000001', true);
select set_config(
  'novelight.test.b20_poll',
  public.novelight_create_my_novel_poll(
    794001,
    '次に読みたい展開は？',
    array['探索を深める', '決戦へ進む', '日常回を読む']::text[]
  ) ->> 'poll_id',
  true
);

do $$
declare
  v_rows jsonb;
begin
  v_rows := public.novelight_manage_my_novel_polls(794001, 50);
  if pg_catalog.jsonb_array_length(v_rows) <> 1
     or v_rows #>> '{0,status}' <> 'active'
     or pg_catalog.jsonb_array_length(v_rows #> '{0,options}') <> 3
     or (v_rows #>> '{0,total_votes}')::bigint <> 0 then
    raise exception 'B #20 owner management feed is incorrect';
  end if;
end
$$;

do $$
begin
  begin
    perform * from public.novel_polls;
    raise exception 'B #20 raw novel_polls unexpectedly readable';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.novel_poll_votes;
    raise exception 'B #20 raw novel_poll_votes unexpectedly readable';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.novelight_create_my_novel_poll(
      794001, '同時開催', array['A','B']::text[]
    );
    raise exception 'B #20 allowed a second active poll';
  exception when invalid_parameter_value then null;
  end;
end
$$;

do $$
begin
  begin
    perform public.novelight_create_my_novel_poll(
      794002, '下書き作品', array['A','B']::text[]
    );
    raise exception 'B #20 allowed poll creation on a draft novel';
  exception when insufficient_privilege then null;
  end;
end
$$;

reset role;
select set_config('request.jwt.claim.sub', '', true);

set local role anon;
do $$
declare
  v_poll jsonb;
begin
  v_poll := public.novelight_public_novel_poll(794001);
  if v_poll is null
     or v_poll ->> 'vote_reason' <> 'login_required'
     or (v_poll ->> 'can_vote')::boolean
     or v_poll #> '{options,0,vote_count}' <> 'null'::jsonb
     or v_poll -> 'total_votes' <> 'null'::jsonb then
    raise exception 'B #20 anonymous active-poll privacy is incorrect';
  end if;
end
$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '79400000-0000-0000-0000-000000000003', true);
select set_config(
  'novelight.test.b20_option',
  public.novelight_public_novel_poll(794001) #>> '{options,0,id}',
  true
);

do $$
declare
  v_poll jsonb;
begin
  v_poll := public.novelight_public_novel_poll(794001);
  if v_poll ->> 'vote_reason' <> 'eligible'
     or not (v_poll ->> 'can_vote')::boolean
     or v_poll #> '{options,0,vote_count}' <> 'null'::jsonb then
    raise exception 'B #20 authenticated pre-vote state is incorrect';
  end if;
end
$$;

select public.novelight_vote_novel_poll(
  current_setting('novelight.test.b20_poll')::bigint,
  current_setting('novelight.test.b20_option')::bigint
);

do $$
declare
  v_poll jsonb;
begin
  v_poll := public.novelight_public_novel_poll(794001);
  if v_poll ->> 'vote_reason' <> 'already_voted'
     or (v_poll ->> 'can_vote')::boolean
     or (v_poll ->> 'viewer_option_id')::bigint <> current_setting('novelight.test.b20_option')::bigint
     or (v_poll ->> 'total_votes')::bigint <> 1
     or (v_poll #>> '{options,0,vote_count}')::bigint <> 1 then
    raise exception 'B #20 post-vote result state is incorrect';
  end if;
end
$$;

do $$
begin
  begin
    perform public.novelight_vote_novel_poll(
      current_setting('novelight.test.b20_poll')::bigint,
      current_setting('novelight.test.b20_option')::bigint
    );
    raise exception 'B #20 duplicate vote unexpectedly succeeded';
  exception when invalid_parameter_value then null;
  end;
end
$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '79400000-0000-0000-0000-000000000004', true);
do $$
declare
  v_poll jsonb;
begin
  v_poll := public.novelight_public_novel_poll(794001);
  if v_poll ->> 'vote_reason' <> 'eligible'
     or v_poll #> '{options,0,vote_count}' <> 'null'::jsonb
     or v_poll -> 'total_votes' <> 'null'::jsonb then
    raise exception 'B #20 nonvoter saw aggregate results before voting';
  end if;
end
$$;
reset role;

insert into public.user_blocks (blocker_user_id, blocked_user_id)
values (
  '79400000-0000-0000-0000-000000000001',
  '79400000-0000-0000-0000-000000000004'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '79400000-0000-0000-0000-000000000004', true);
do $$
declare
  v_poll jsonb;
begin
  v_poll := public.novelight_public_novel_poll(794001);
  if v_poll ->> 'vote_reason' <> 'blocked'
     or (v_poll ->> 'can_vote')::boolean then
    raise exception 'B #20 block boundary did not disable direct poll interaction';
  end if;
  begin
    perform public.novelight_vote_novel_poll(
      current_setting('novelight.test.b20_poll')::bigint,
      current_setting('novelight.test.b20_option')::bigint
    );
    raise exception 'B #20 blocked reader unexpectedly voted';
  exception when insufficient_privilege then null;
  end;
end
$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '79400000-0000-0000-0000-000000000001', true);
do $$
begin
  begin
    perform public.novelight_vote_novel_poll(
      current_setting('novelight.test.b20_poll')::bigint,
      current_setting('novelight.test.b20_option')::bigint
    );
    raise exception 'B #20 author self-vote unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end
$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '79400000-0000-0000-0000-000000000002', true);
do $$
begin
  begin
    perform public.novelight_close_my_novel_poll(
      current_setting('novelight.test.b20_poll')::bigint
    );
    raise exception 'B #20 cross-author close unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end
$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '79400000-0000-0000-0000-000000000001', true);
select public.novelight_close_my_novel_poll(
  current_setting('novelight.test.b20_poll')::bigint
);
reset role;
select set_config('request.jwt.claim.sub', '', true);

set local role anon;
do $$
declare
  v_poll jsonb;
begin
  v_poll := public.novelight_public_novel_poll(794001);
  if v_poll ->> 'status' <> 'closed'
     or v_poll ->> 'vote_reason' <> 'closed'
     or (v_poll ->> 'total_votes')::bigint <> 1
     or (v_poll #>> '{options,0,vote_count}')::bigint <> 1 then
    raise exception 'B #20 closed poll did not expose final aggregate results';
  end if;
end
$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '79400000-0000-0000-0000-000000000001', true);
select public.novelight_create_my_novel_poll(
  794001,
  '次のアンケート',
  array['短編', '長編']::text[]
);
reset role;
select set_config('request.jwt.claim.sub', '', true);

set local role anon;
do $$
declare
  v_poll jsonb;
begin
  v_poll := public.novelight_public_novel_poll(794001);
  if v_poll ->> 'question' <> '次のアンケート'
     or v_poll ->> 'status' <> 'active'
     or v_poll #> '{options,0,vote_count}' <> 'null'::jsonb then
    raise exception 'B #20 did not prefer the new active poll';
  end if;
end
$$;
reset role;

update public.novels set status='draft' where id=794001;

set local role anon;
do $$
begin
  if public.novelight_public_novel_poll(794001) is not null then
    raise exception 'B #20 poll leaked after its novel became private';
  end if;
end
$$;
reset role;

rollback;
