begin;

insert into auth.users (id, raw_user_meta_data)
values
  ('83000000-0000-0000-0000-000000000001', '{"display_name":"Illustration Owner"}'::jsonb),
  ('83000000-0000-0000-0000-000000000002', '{"display_name":"Illustration Editor"}'::jsonb),
  ('83000000-0000-0000-0000-000000000003', '{"display_name":"Illustration Outsider"}'::jsonb)
on conflict (id) do nothing;

insert into public.profiles (id, display_name)
values
  ('83000000-0000-0000-0000-000000000001', 'Illustration Owner'),
  ('83000000-0000-0000-0000-000000000002', 'Illustration Editor'),
  ('83000000-0000-0000-0000-000000000003', 'Illustration Outsider')
on conflict (id) do update set display_name=excluded.display_name;

insert into public.novel_thumbnail_assets (
  id, label, storage_path, image_url, created_by
)
values (
  '83000000-0000-0000-0000-000000000010',
  'Illustration fixture thumbnail',
  'official/83000000-0000-0000-0000-000000000010.webp',
  'https://example.invalid/illustration-fixture.webp',
  '83000000-0000-0000-0000-000000000001'
)
on conflict (id) do nothing;

insert into public.novels (
  id, user_id, title, description, genre, status, pv, ai_usage,
  content_policy_ack, content_policy_version, thumbnail_asset_id
)
overriding system value
values (
  830001, '83000000-0000-0000-0000-000000000001',
  'Illustration Work', 'fixture', 'ファンタジー', 'published', 0, 'human',
  true, 'beta-v1', '83000000-0000-0000-0000-000000000010'
);

insert into public.episodes (
  id, novel_id, user_id, episode_number, title, content, status, pv
)
overriding system value
values
  (
    830001, 830001, '83000000-0000-0000-0000-000000000001',
    1, 'Public illustrated episode',
    '前半\n[[NOVELIGHT_ILLUSTRATION:83000000-0000-4000-8000-000000000101]]\n後半',
    'published', 0
  ),
  (
    830002, 830001, '83000000-0000-0000-0000-000000000001',
    2, 'Draft illustrated episode', 'draft body', 'draft', 0
  );

insert into public.novel_collaborators (
  novel_id, collaborator_user_id, role
) values (
  830001, '83000000-0000-0000-0000-000000000002', 'editor'
);

set local role authenticated;
select set_config('request.jwt.claim.sub','83000000-0000-0000-0000-000000000001',true);
do $$
begin
  begin
    perform * from public.episode_illustrations;
    raise exception 'Raw episode illustration table unexpectedly readable';
  exception when insufficient_privilege then null;
  end;

  begin
    perform * from public.episode_illustration_upload_audit;
    raise exception 'Raw illustration upload audit unexpectedly readable';
  exception when insufficient_privilege then null;
  end;
end
$$;
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role service_role;

do $$
declare
  v_attempt integer;
begin
  begin
    perform public.novelight_authorize_episode_illustration_upload(
      830001, '83000000-0000-0000-0000-000000000003'
    );
    raise exception 'Outsider unexpectedly received signed-upload authorization';
  exception when insufficient_privilege then null;
  end;

  for v_attempt in 1..20 loop
    if not public.novelight_authorize_episode_illustration_upload(
      830001, '83000000-0000-0000-0000-000000000001'
    ) then
      raise exception 'Owner signed-upload authorization unexpectedly failed';
    end if;
  end loop;

  begin
    perform public.novelight_authorize_episode_illustration_upload(
      830001, '83000000-0000-0000-0000-000000000001'
    );
    raise exception 'Upload issuance rate limit unexpectedly allowed request 21';
  exception
    when raise_exception then
      if position('EPISODE_ILLUSTRATION_UPLOAD_RATE_LIMITED' in sqlerrm) = 0 then
        raise;
      end if;
  end;
end
$$;

do $$
declare
  v_bundle jsonb;
begin
  v_bundle := public.novelight_episode_illustration_editor_bundle(
    830001, '83000000-0000-0000-0000-000000000003'
  );
  if coalesce((v_bundle ->> 'can_edit')::boolean, false) then
    raise exception 'Outsider unexpectedly received illustration edit access';
  end if;

  begin
    perform public.novelight_set_illustration_ai_usage(
      830001, '83000000-0000-0000-0000-000000000002', true
    );
    raise exception 'Collaborator unexpectedly changed work-level illustration AI declaration';
  exception when insufficient_privilege then null;
  end;

  if not public.novelight_set_illustration_ai_usage(
    830001, '83000000-0000-0000-0000-000000000001', true
  ) then
    raise exception 'Owner illustration AI declaration failed';
  end if;
end
$$;

do $$
declare
  v_id uuid;
begin
  v_id := public.novelight_register_episode_illustration(
    830001,
    '83000000-0000-0000-0000-000000000001',
    '83000000-0000-0000-0000-000000000001/830001/83000000-0000-4000-8000-000000000101.webp',
    'image/webp',
    12345,
    1200,
    800,
    '夕暮れの街並み'
  );
  if v_id <> '83000000-0000-4000-8000-000000000101'::uuid then
    -- Registry IDs are independently generated; path UUID is intentionally not the DB ID.
    null;
  end if;
  perform set_config('novelight.test.illustration_id', v_id::text, true);

  begin
    perform public.novelight_register_episode_illustration(
      830001,
      '83000000-0000-0000-0000-000000000001',
      '83000000-0000-0000-0000-000000000003/830001/83000000-0000-4000-8000-000000000102.webp',
      'image/webp', 12345, 1200, 800, ''
    );
    raise exception 'Cross-owner illustration storage path unexpectedly registered';
  exception when invalid_parameter_value then null;
  end;
end
$$;
do $$
declare
  v_id uuid := current_setting('novelight.test.illustration_id')::uuid;
  v_bundle jsonb;
begin
  if not public.novelight_update_episode_illustration_alt(
    v_id,
    '83000000-0000-0000-0000-000000000002',
    '共同編集者が更新した代替テキスト'
  ) then
    raise exception 'Collaborator alt-text update failed';
  end if;

  v_bundle := public.novelight_episode_illustration_editor_bundle(
    830001, '83000000-0000-0000-0000-000000000002'
  );
  if not (v_bundle ->> 'can_edit')::boolean
     or (v_bundle ->> 'is_owner')::boolean
     or pg_catalog.jsonb_array_length(v_bundle -> 'assets') <> 1
     or v_bundle #>> '{assets,0,alt_text}' <> '共同編集者が更新した代替テキスト' then
    raise exception 'Collaborator illustration editor bundle is incorrect';
  end if;

  v_bundle := public.novelight_public_episode_illustration_bundle(830001);
  if v_bundle is null
     or pg_catalog.jsonb_array_length(v_bundle -> 'assets') <> 1
     or not (v_bundle ->> 'illustration_ai_usage')::boolean then
    raise exception 'Published illustration bundle is incorrect';
  end if;

  if public.novelight_public_episode_illustration_bundle(830002) is not null then
    raise exception 'Draft episode illustration bundle unexpectedly became public';
  end if;
end
$$;

do $$
declare
  v_export jsonb;
begin
  v_export := public.novelight_owner_illustration_export_bundle(
    830001, '83000000-0000-0000-0000-000000000001'
  );
  if pg_catalog.jsonb_array_length(v_export -> 'assets') <> 1 then
    raise exception 'Owner illustration export bundle is incomplete';
  end if;

  begin
    perform public.novelight_owner_illustration_export_bundle(
      830001, '83000000-0000-0000-0000-000000000003'
    );
    raise exception 'Outsider unexpectedly received illustration export bundle';
  exception when insufficient_privilege then null;
  end;

  begin
    perform * from public.episode_illustrations;
    raise exception 'service_role unexpectedly received raw illustration table access';
  exception when insufficient_privilege then null;
  end;

  begin
    perform * from public.episode_illustration_upload_audit;
    raise exception 'service_role unexpectedly received raw illustration upload audit access';
  exception when insufficient_privilege then null;
  end;
end
$$;

reset role;
rollback;
