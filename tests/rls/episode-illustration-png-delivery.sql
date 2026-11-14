begin;

insert into auth.users (id, raw_user_meta_data)
values
  ('84000000-0000-0000-0000-000000000001', '{"display_name":"Illustration Owner"}'::jsonb),
  ('84000000-0000-0000-0000-000000000002', '{"display_name":"Illustration Editor"}'::jsonb),
  ('84000000-0000-0000-0000-000000000003', '{"display_name":"Illustration Outsider"}'::jsonb)
on conflict (id) do nothing;

insert into public.profiles (id, display_name)
values
  ('84000000-0000-0000-0000-000000000001', 'Illustration Owner'),
  ('84000000-0000-0000-0000-000000000002', 'Illustration Editor'),
  ('84000000-0000-0000-0000-000000000003', 'Illustration Outsider')
on conflict (id) do update set display_name=excluded.display_name;

insert into public.novel_thumbnail_assets (
  id, label, storage_path, image_url, created_by
)
values (
  '84000000-0000-0000-0000-000000000010',
  'Illustration fixture thumbnail',
  'official/84000000-0000-0000-0000-000000000010.webp',
  'https://example.invalid/illustration-fixture.webp',
  '84000000-0000-0000-0000-000000000001'
)
on conflict (id) do nothing;

insert into public.novels (
  id, user_id, title, description, genre, status, pv, ai_usage,
  content_policy_ack, content_policy_version, thumbnail_asset_id
)
overriding system value
values (
  840001, '84000000-0000-0000-0000-000000000001',
  'Illustration Work', 'fixture', 'ファンタジー', 'published', 0, 'human',
  true, 'beta-v1', '84000000-0000-0000-0000-000000000010'
);

insert into public.episodes (
  id, novel_id, user_id, episode_number, title, content, status, pv
)
overriding system value
values
  (
    840001, 840001, '84000000-0000-0000-0000-000000000001',
    1, 'Public illustrated episode',
    'PNG body before insert',
    'published', 0
  ),
  (
    840002, 840001, '84000000-0000-0000-0000-000000000001',
    2, 'Draft illustrated episode', 'draft body', 'draft', 0
  );

insert into public.novel_collaborators (
  novel_id, collaborator_user_id, role
) values (
  840001, '84000000-0000-0000-0000-000000000002', 'editor'
);


set local role service_role;
do $$
declare
  v_id uuid;
  v_owner uuid := '84000000-0000-0000-0000-000000000001';
  v_path text := '84000000-0000-0000-0000-000000000001/840002/84000000-0000-4000-8000-000000000102.png';
begin
  if not public.novelight_set_illustration_ai_usage(840001, v_owner, false) then
    raise exception 'Fixture AI declaration failed';
  end if;
  v_id := public.novelight_register_episode_illustration(
    840002, v_owner, v_path, 'image/png', 426061, 1024, 768,
    'Safari PNG fallback'
  );
  if not exists (
    select 1 from public.episode_illustrations
     where id=v_id and episode_id=840002 and mime_type='image/png'
       and storage_path=v_path and width=1024 and height=768
  ) then
    raise exception 'PNG registry lost MIME, extension or image dimensions';
  end if;

  begin
    perform public.novelight_register_episode_illustration(
      840002, v_owner,
      '84000000-0000-0000-0000-000000000001/840002/84000000-0000-4000-8000-000000000103.webp',
      'image/png', 50, 5, 5, ''
    );
    raise exception 'Mismatched PNG MIME with WebP extension unexpectedly registered';
  exception when invalid_parameter_value then null;
  end;

  begin
    perform public.novelight_register_episode_illustration(
      840002, '84000000-0000-0000-0000-000000000003', v_path,
      'image/png', 50, 5, 5, ''
    );
    raise exception 'Outsider unexpectedly registered PNG';
  exception when insufficient_privilege then null;
  end;

  perform pg_catalog.set_config('novelight.fixture.png_id',v_id::text,true);
end
$$;
reset role;
do $$
declare
  v_id uuid := pg_catalog.current_setting('novelight.fixture.png_id')::uuid;
  v_bundle jsonb;
begin
  update public.episodes
     set content='PNG text' || E'\n' || '[[NOVELIGHT_ILLUSTRATION:' || v_id::text || ']]'
   where id=840002;
  set constraints public.novelight_validate_episode_illustration_refs immediate;
  v_bundle := public.novelight_owner_illustration_export_bundle(
    840001,'84000000-0000-0000-0000-000000000001'
  );
  if pg_catalog.jsonb_array_length(v_bundle->'assets')<>1
     or v_bundle #>> '{assets,0,mime_type}' <> 'image/png'
     or v_bundle #>> '{assets,0,storage_path}' !~ '\.png$'
  then
    raise exception 'PNG MIME/extension not preserved in owner export bundle';
  end if;
end
$$;
rollback;
