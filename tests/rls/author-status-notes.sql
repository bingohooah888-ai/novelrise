\set ON_ERROR_STOP on

begin;

insert into auth.users (id, raw_user_meta_data)
values
  ('79300000-0000-0000-0000-000000000001', '{"display_name":"B19 Author A"}'::jsonb),
  ('79300000-0000-0000-0000-000000000002', '{"display_name":"B19 Author B"}'::jsonb)
on conflict (id) do nothing;

insert into public.profiles (id, display_name)
values
  ('79300000-0000-0000-0000-000000000001', 'B19 Author A'),
  ('79300000-0000-0000-0000-000000000002', 'B19 Author B')
on conflict (id) do update set display_name = excluded.display_name;

insert into public.novel_thumbnail_assets (
  id, label, storage_path, image_url, created_by
)
values (
  '79300000-0000-0000-0000-000000000010',
  'B19 fixture thumbnail',
  'official/79300000-0000-0000-0000-000000000010.webp',
  'https://example.invalid/b19-fixture.webp',
  '79300000-0000-0000-0000-000000000001'
)
on conflict (id) do nothing;
insert into public.novels (
  id, user_id, title, description, genre, status, pv, ai_usage,
  content_policy_ack, content_policy_version, thumbnail_asset_id
)
overriding system value
values
  (
    793001, '79300000-0000-0000-0000-000000000001',
    'B19 Public Work', 'fixture', 'ファンタジー', 'published', 0, 'human',
    true, 'beta-v1', '79300000-0000-0000-0000-000000000010'
  ),
  (
    793002, '79300000-0000-0000-0000-000000000001',
    'B19 Draft Work', 'fixture', 'ファンタジー', 'draft', 0, 'human',
    true, 'beta-v1', '79300000-0000-0000-0000-000000000010'
  ),
  (
    793003, '79300000-0000-0000-0000-000000000002',
    'B19 Other Work', 'fixture', 'ミステリー', 'published', 0, 'human',
    true, 'beta-v1', '79300000-0000-0000-0000-000000000010'
  );

set local role authenticated;
select set_config('request.jwt.claim.sub', '79300000-0000-0000-0000-000000000001', true);
select set_config(
  'novelight.test.b19_note',
  public.novelight_save_my_author_note(null, '執筆中', '次話を準備しています。', 793001) ->> 'note_id',
  true
);
do $$
declare
  v_notes jsonb;
begin
  v_notes := public.novelight_manage_my_author_notes(100);
  if pg_catalog.jsonb_array_length(v_notes) <> 1
     or v_notes #>> '{0,title}' <> '執筆中'
     or (v_notes #>> '{0,linked_novel_id}')::bigint <> 793001 then
    raise exception 'B #19 owner management feed is incorrect';
  end if;
end
$$;

do $$
begin
  begin
    perform * from public.author_notes;
    raise exception 'B #19 raw author_notes table unexpectedly readable';
  exception when insufficient_privilege then null;
  end;
end
$$;

reset role;
select set_config('request.jwt.claim.sub', '', true);

set local role anon;
do $$
declare
  v_notes jsonb;
begin
  v_notes := public.novelight_public_author_notes(
    '79300000-0000-0000-0000-000000000001',
    5
  );
  if pg_catalog.jsonb_array_length(v_notes) <> 1
     or v_notes #>> '{0,title}' <> '執筆中'
     or (v_notes #>> '{0,linked_novel,id}')::bigint <> 793001
     or v_notes #>> '{0,linked_novel,title}' <> 'B19 Public Work' then
    raise exception 'B #19 public note feed is incorrect';
  end if;
end
$$;
do $$
begin
  begin
    perform public.novelight_manage_my_author_notes(5);
    raise exception 'Anonymous user unexpectedly executed B #19 management RPC';
  exception when insufficient_privilege then null;
  end;
end
$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '79300000-0000-0000-0000-000000000002', true);
do $$
begin
  begin
    perform public.novelight_save_my_author_note(
      null, '不正リンク', '他作者作品へのリンク', 793001
    );
    raise exception 'B #19 cross-author linked novel unexpectedly accepted';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.novelight_archive_my_author_note(
      current_setting('novelight.test.b19_note')::bigint
    );
    raise exception 'B #19 cross-author archive unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end
$$;
reset role;
select set_config('request.jwt.claim.sub', '', true);

update public.novels set status='draft' where id=793001;
set local role anon;
do $$
declare
  v_notes jsonb;
begin
  v_notes := public.novelight_public_author_notes(
    '79300000-0000-0000-0000-000000000001',
    5
  );
  if pg_catalog.jsonb_array_length(v_notes) <> 1 then
    raise exception 'B #19 note disappeared when only its linked work became private';
  end if;
  if v_notes #> '{0,linked_novel}' <> 'null'::jsonb then
    raise exception 'B #19 unpublished linked novel leaked through public notes';
  end if;
end
$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '79300000-0000-0000-0000-000000000001', true);
select public.novelight_archive_my_author_note(
  current_setting('novelight.test.b19_note')::bigint
);
do $$
declare
  v_notes jsonb;
begin
  v_notes := public.novelight_manage_my_author_notes(100);
  if v_notes #>> '{0,status}' <> 'archived' then
    raise exception 'B #19 owner archive did not persist';
  end if;
end
$$;
reset role;
select set_config('request.jwt.claim.sub', '', true);

set local role anon;
do $$
declare
  v_notes jsonb;
begin
  v_notes := public.novelight_public_author_notes(
    '79300000-0000-0000-0000-000000000001',
    5
  );
  if pg_catalog.jsonb_array_length(v_notes) <> 0 then
    raise exception 'B #19 archived note remained public';
  end if;
end
$$;
reset role;

rollback;
