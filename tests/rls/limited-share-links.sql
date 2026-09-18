\set ON_ERROR_STOP on

begin;

insert into auth.users (id, raw_user_meta_data)
values
  ('79800000-0000-0000-0000-000000000001', '{"display_name":"B16 Author"}'::jsonb),
  ('79800000-0000-0000-0000-000000000002', '{"display_name":"B16 Other"}'::jsonb)
on conflict (id) do nothing;

insert into public.profiles (id, display_name)
values
  ('79800000-0000-0000-0000-000000000001', 'B16 Author'),
  ('79800000-0000-0000-0000-000000000002', 'B16 Other')
on conflict (id) do update set display_name = excluded.display_name;

insert into public.novel_thumbnail_assets (
  id, label, storage_path, image_url, created_by
)
values (
  '79800000-0000-0000-0000-000000000003',
  'B16 fixture thumbnail',
  'official/79800000-0000-0000-0000-000000000003.webp',
  'https://example.invalid/b16-fixture.webp',
  '79800000-0000-0000-0000-000000000001'
)
on conflict (id) do nothing;

insert into public.novels (
  id, user_id, title, description, genre, status, pv, ai_usage,
  content_policy_ack, content_policy_version, thumbnail_asset_id
)
overriding system value
values (
  798001,
  '79800000-0000-0000-0000-000000000001',
  'B16 Shared Draft',
  'draft shared only by opaque token',
  'ファンタジー',
  'draft',
  0,
  'human',
  true,
  'beta-v1',
  '79800000-0000-0000-0000-000000000003'
);

insert into public.episodes (
  id, novel_id, user_id, episode_number, title, content, status, pv
)
overriding system value
values
  (
    798011, 798001, '79800000-0000-0000-0000-000000000001',
    1, 'Draft one', '限定共有の第一話本文。', 'draft', 0
  ),
  (
    798012, 798001, '79800000-0000-0000-0000-000000000001',
    2, 'Draft two', '限定共有の第二話本文。', 'draft', 0
  );

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '79800000-0000-0000-0000-000000000001',
  true
);
select set_config(
  'novelight.test.b16_token',
  public.novelight_rotate_share_link(798001) ->> 'token',
  true
);

do $$
declare
  v_status jsonb;
begin
  if current_setting('novelight.test.b16_token') !~ '^[0-9a-f]{64}$' then
    raise exception 'B #16 did not return a 256-bit hex share token';
  end if;

  v_status := public.novelight_share_link_status(798001);
  if coalesce((v_status ->> 'eligible')::boolean, false) is not true
     or coalesce((v_status ->> 'enabled')::boolean, false) is not true then
    raise exception 'Owner share status did not report an enabled draft link';
  end if;

  if (select status from public.novels where id = 798001) <> 'draft' then
    raise exception 'Creating a limited share changed normal publication status';
  end if;
end
$$;
reset role;
select set_config('request.jwt.claim.sub', '', true);

-- Another author must not inspect, rotate, or revoke the owner's share link.
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '79800000-0000-0000-0000-000000000002',
  true
);
do $$
begin
  begin
    perform public.novelight_share_link_status(798001);
    raise exception 'Non-owner unexpectedly read share-link status';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform public.novelight_rotate_share_link(798001);
    raise exception 'Non-owner unexpectedly rotated share link';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform public.novelight_revoke_share_link(798001);
    raise exception 'Non-owner unexpectedly revoked share link';
  exception
    when insufficient_privilege then null;
  end;
end
$$;
reset role;
select set_config('request.jwt.claim.sub', '', true);

-- The draft stays invisible through normal RLS, while token RPCs can expose it.
set local role anon;
do $$
declare
  v_count bigint;
  v_novel jsonb;
  v_episode jsonb;
begin
  select count(*) into v_count from public.novels where id = 798001;
  if v_count <> 0 then
    raise exception 'Draft share unexpectedly became directly public';
  end if;

  select count(*) into v_count from public.episodes where novel_id = 798001;
  if v_count <> 0 then
    raise exception 'Draft episodes unexpectedly became directly public';
  end if;

  v_novel := public.novelight_shared_novel(
    current_setting('novelight.test.b16_token')
  );
  if v_novel is null
     or v_novel ->> 'title' <> 'B16 Shared Draft'
     or pg_catalog.jsonb_array_length(v_novel -> 'episodes') <> 2
     or v_novel ? 'id'
     or v_novel ? 'pv'
     or v_novel ? 'favorites' then
    raise exception 'Token-bound shared novel payload is missing or leaks internal fields';
  end if;

  v_episode := public.novelight_shared_episode(
    current_setting('novelight.test.b16_token'),
    1
  );
  if v_episode is null
     or v_episode ->> 'content' <> '限定共有の第一話本文。'
     or (v_episode ->> 'next_episode_number')::integer <> 2 then
    raise exception 'Token-bound shared episode payload is incorrect';
  end if;

  if public.novelight_shared_novel(repeat('0', 64)) is not null then
    raise exception 'Invalid share token unexpectedly resolved a draft';
  end if;
end
$$;
reset role;

-- Raw secret hashes must not be readable through client roles.
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '79800000-0000-0000-0000-000000000001',
  true
);
do $$
declare
  v_count bigint;
begin
  begin
    execute 'select count(*) from public.novel_share_links' into v_count;
    raise exception 'Authenticated role unexpectedly read raw share-link table';
  exception
    when insufficient_privilege then null;
  end;
end
$$;
reset role;
select set_config('request.jwt.claim.sub', '', true);

-- Publishing through the existing publication source of truth must revoke the link.
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '79800000-0000-0000-0000-000000000001',
  true
);
select public.novelight_publish_episode_draft_atomic(798011);
reset role;
select set_config('request.jwt.claim.sub', '', true);

do $$
begin
  if exists (
    select 1 from public.novel_share_links where novel_id = 798001
  ) then
    raise exception 'Publishing the work did not revoke its limited share link';
  end if;
end
$$;

set local role anon;
do $$
begin
  if public.novelight_shared_novel(
       current_setting('novelight.test.b16_token')
     ) is not null then
    raise exception 'Old share token still resolved after publication';
  end if;
end
$$;
reset role;

do $$
begin
  if not has_function_privilege(
       'anon',
       'public.novelight_shared_novel(text)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'anon',
       'public.novelight_shared_episode(text,bigint)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.novelight_rotate_share_link(bigint)',
       'EXECUTE'
     ) then
    raise exception 'B #16 RPC grants are incorrect';
  end if;
end
$$;

rollback;
