\set ON_ERROR_STOP on

begin;

insert into auth.users (id, raw_user_meta_data)
values
  ('79500000-0000-0000-0000-000000000001', '{"display_name":"B21 Reader A"}'::jsonb),
  ('79500000-0000-0000-0000-000000000002', '{"display_name":"B21 Reader B"}'::jsonb)
on conflict (id) do nothing;

insert into public.profiles (id, display_name)
values
  ('79500000-0000-0000-0000-000000000001', 'B21 Reader A'),
  ('79500000-0000-0000-0000-000000000002', 'B21 Reader B')
on conflict (id) do update set display_name = excluded.display_name;

insert into public.novel_thumbnail_assets (
  id, label, storage_path, image_url, created_by
)
values (
  '79500000-0000-0000-0000-000000000010',
  'B21 fixture thumbnail',
  'official/79500000-0000-0000-0000-000000000010.webp',
  'https://example.invalid/b21-fixture.webp',
  '79500000-0000-0000-0000-000000000001'
)
on conflict (id) do nothing;

insert into public.novels (
  id, user_id, title, description, genre, status, pv, ai_usage,
  content_policy_ack, content_policy_version, thumbnail_asset_id
)
overriding system value
values
  (
    795001, '79500000-0000-0000-0000-000000000001',
    'B21 Public Work', 'fixture public', 'ファンタジー', 'published', 0, 'human',
    true, 'beta-v1', '79500000-0000-0000-0000-000000000010'
  ),
  (
    795002, '79500000-0000-0000-0000-000000000001',
    'B21 Draft Work', 'fixture draft', 'ファンタジー', 'draft', 0, 'human',
    true, 'beta-v1', '79500000-0000-0000-0000-000000000010'
  );

do $$
begin
  if has_table_privilege('anon','public.reader_curation_lists','select')
     or has_table_privilege('authenticated','public.reader_curation_lists','select')
     or has_table_privilege('authenticated','public.reader_curation_list_items','insert') then
    raise exception 'B21 raw tables must not be directly accessible';
  end if;
end
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '79500000-0000-0000-0000-000000000001', true);
select set_config(
  'novelight.test.b21_list',
  public.novelight_create_my_curation_list('夜に読む', '静かな作品') ->> 'list_id',
  true
);
select set_config(
  'novelight.test.b21_token',
  public.novelight_manage_my_curation_lists() -> 0 ->> 'share_token',
  true
);

do $$
declare
  v_lists jsonb;
begin
  v_lists := public.novelight_manage_my_curation_lists();
  if pg_catalog.jsonb_array_length(v_lists) <> 1 then
    raise exception 'B21 owner must see exactly one created list';
  end if;
  if v_lists -> 0 ->> 'visibility' <> 'private' then
    raise exception 'B21 new lists must default private';
  end if;
end
$$;

select public.novelight_add_my_curation_item(
  current_setting('novelight.test.b21_list')::bigint,
  795001
);

do $$
begin
  begin
    perform public.novelight_add_my_curation_item(
      current_setting('novelight.test.b21_list')::bigint,
      795002
    );
    raise exception 'B21 draft novel add unexpectedly succeeded';
  exception
    when sqlstate '22023' then null;
  end;
end
$$;

select public.novelight_update_my_curation_list(
  current_setting('novelight.test.b21_list')::bigint,
  '夜に読む',
  '静かな作品',
  'shared'
);

set local role anon;
select set_config('request.jwt.claim.sub', '', true);

do $$
declare
  v_public jsonb;
begin
  v_public := public.novelight_public_reader_curation(
    current_setting('novelight.test.b21_token')::uuid
  );
  if v_public is null then
    raise exception 'B21 shared list must be visible through its token';
  end if;
  if v_public ->> 'curator_display_name' <> 'B21 Reader A' then
    raise exception 'B21 public list must expose only the curator display name';
  end if;
  if pg_catalog.jsonb_array_length(v_public -> 'items') <> 1 then
    raise exception 'B21 shared list must expose one published item';
  end if;
  if v_public #>> '{items,0,title}' <> 'B21 Public Work' then
    raise exception 'B21 public item title mismatch';
  end if;
end
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '79500000-0000-0000-0000-000000000002', true);

do $$
begin
  begin
    perform public.novelight_update_my_curation_list(
      current_setting('novelight.test.b21_list')::bigint,
      '乗っ取り',
      '',
      'shared'
    );
    raise exception 'B21 cross-reader update unexpectedly succeeded';
  exception
    when insufficient_privilege then null;
  end;
end
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '79500000-0000-0000-0000-000000000001', true);
select set_config(
  'novelight.test.b21_old_token',
  current_setting('novelight.test.b21_token'),
  true
);
select set_config(
  'novelight.test.b21_token',
  public.novelight_rotate_my_curation_share_token(
    current_setting('novelight.test.b21_list')::bigint
  ) ->> 'share_token',
  true
);

set local role anon;
select set_config('request.jwt.claim.sub', '', true);

do $$
begin
  if public.novelight_public_reader_curation(
    current_setting('novelight.test.b21_old_token')::uuid
  ) is not null then
    raise exception 'B21 rotated token must stop resolving immediately';
  end if;
  if public.novelight_public_reader_curation(
    current_setting('novelight.test.b21_token')::uuid
  ) is null then
    raise exception 'B21 new token must resolve';
  end if;
end
$$;

reset role;
update public.novels set status='draft' where id=795001;

set local role anon;
select set_config('request.jwt.claim.sub', '', true);

do $$
declare
  v_public jsonb;
begin
  v_public := public.novelight_public_reader_curation(
    current_setting('novelight.test.b21_token')::uuid
  );
  if pg_catalog.jsonb_array_length(v_public -> 'items') <> 0 then
    raise exception 'B21 unpublished novels must disappear from shared output';
  end if;
end
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '79500000-0000-0000-0000-000000000001', true);
select public.novelight_update_my_curation_list(
  current_setting('novelight.test.b21_list')::bigint,
  '夜に読む',
  '静かな作品',
  'private'
);

set local role anon;
select set_config('request.jwt.claim.sub', '', true);

do $$
begin
  if public.novelight_public_reader_curation(
    current_setting('novelight.test.b21_token')::uuid
  ) is not null then
    raise exception 'B21 private list must not resolve publicly';
  end if;
end
$$;

reset role;
rollback;
