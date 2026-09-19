begin;

insert into auth.users (id, raw_user_meta_data)
values
  ('79700000-0000-0000-0000-000000000001', '{"display_name":"B23 Owner"}'::jsonb),
  ('79700000-0000-0000-0000-000000000002', '{"display_name":"B23 Collaborator"}'::jsonb),
  ('79700000-0000-0000-0000-000000000003', '{"display_name":"B23 Outsider"}'::jsonb)
on conflict (id) do nothing;

insert into public.profiles (id, display_name)
values
  ('79700000-0000-0000-0000-000000000001', 'B23 Owner'),
  ('79700000-0000-0000-0000-000000000002', 'B23 Collaborator'),
  ('79700000-0000-0000-0000-000000000003', 'B23 Outsider')
on conflict (id) do update set display_name=excluded.display_name;

insert into public.novel_thumbnail_assets (
  id, label, storage_path, image_url, created_by
)
values (
  '79700000-0000-0000-0000-000000000010',
  'B23 fixture thumbnail',
  'official/79700000-0000-0000-0000-000000000010.webp',
  'https://example.invalid/b23-fixture.webp',
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
    797001,
    '79700000-0000-0000-0000-000000000001',
    'B23 Owner Work',
    'private planning fixture',
    'ファンタジー',
    'draft',
    0,
    'human',
    true,
    'beta-v1',
    '79700000-0000-0000-0000-000000000010'
  ),
  (
    797002,
    '79700000-0000-0000-0000-000000000003',
    'B23 Outsider Work',
    'cross-work fixture',
    'ファンタジー',
    'draft',
    0,
    'human',
    true,
    'beta-v1',
    '79700000-0000-0000-0000-000000000010'
  );

insert into public.novel_collaborators (
  novel_id, collaborator_user_id, role
)
values (
  797001,
  '79700000-0000-0000-0000-000000000002',
  'editor'
);

do $$
begin
  if has_table_privilege('anon','public.novel_private_story_notes','select')
     or has_table_privilege('authenticated','public.novel_private_story_notes','select')
     or has_table_privilege('authenticated','public.novel_private_story_notes','insert') then
    raise exception 'B23 raw private story notes must remain unreachable';
  end if;
end
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '79700000-0000-0000-0000-000000000001', true);

select set_config(
  'novelight.test.b23_owner_character',
  (public.novelight_upsert_character(
    797001, null, '主人公', array['蒼'], true, true
  ) ->> 'character_id'),
  true
);

select set_config(
  'novelight.test.b23_plot_note',
  (public.novelight_save_private_story_note(
    797001, null, 'plot', null, '第一部プロット', '起承転結と伏線'
  ) ->> 'note_id'),
  true
);

select public.novelight_save_private_story_note(
  797001, null, 'world', null, '魔術体系', '登録魔術と適性の整理'
);

select set_config(
  'novelight.test.b23_character_note',
  (public.novelight_save_private_story_note(
    797001,
    null,
    'character',
    current_setting('novelight.test.b23_owner_character')::bigint,
    '主人公の秘密',
    '読者にはまだ見せない設定'
  ) ->> 'note_id'),
  true
);

do $$
declare
  v_notes jsonb;
begin
  v_notes := public.novelight_private_story_notes(797001);
  if pg_catalog.jsonb_array_length(v_notes) <> 3 then
    raise exception 'B23 owner should see exactly three private notes';
  end if;
  if not exists (
    select 1
      from pg_catalog.jsonb_array_elements(v_notes) note
     where note ->> 'note_type' = 'character'
       and note ->> 'character_name' = '主人公'
       and note ->> 'body' = '読者にはまだ見せない設定'
  ) then
    raise exception 'B23 character note did not reuse canonical character registry';
  end if;
end
$$;

do $$
begin
  begin
    perform * from public.novel_private_story_notes;
    raise exception 'B23 owner unexpectedly read raw private note table';
  exception
    when insufficient_privilege then null;
  end;
end
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '79700000-0000-0000-0000-000000000002', true);

do $$
begin
  begin
    perform public.novelight_private_story_notes(797001);
    raise exception 'B23 collaborator unexpectedly read owner private planning notes';
  exception
    when insufficient_privilege then null;
  end;
  begin
    perform public.novelight_save_private_story_note(
      797001, null, 'plot', null, '侵入', '不可'
    );
    raise exception 'B23 collaborator unexpectedly wrote owner private planning notes';
  exception
    when insufficient_privilege then null;
  end;
end
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '79700000-0000-0000-0000-000000000003', true);

select set_config(
  'novelight.test.b23_outsider_character',
  (public.novelight_upsert_character(
    797002, null, '別作品人物', '{}'::text[], true, true
  ) ->> 'character_id'),
  true
);

do $$
begin
  begin
    perform public.novelight_private_story_notes(797001);
    raise exception 'B23 outsider unexpectedly read private planning notes';
  exception
    when insufficient_privilege then null;
  end;
end
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '79700000-0000-0000-0000-000000000001', true);

do $$
begin
  begin
    perform public.novelight_save_private_story_note(
      797001,
      null,
      'character',
      current_setting('novelight.test.b23_outsider_character')::bigint,
      '越境人物',
      '別作品への誤リンク'
    );
    raise exception 'B23 cross-work character link unexpectedly succeeded';
  exception
    when invalid_parameter_value then null;
  end;
end
$$;

select public.novelight_delete_character(
  current_setting('novelight.test.b23_owner_character')::bigint
);

do $$
declare
  v_notes jsonb;
begin
  v_notes := public.novelight_private_story_notes(797001);
  if not exists (
    select 1
      from pg_catalog.jsonb_array_elements(v_notes) note
     where note ->> 'title' = '主人公の秘密'
       and note ->> 'body' = '読者にはまだ見せない設定'
       and note -> 'character_id' = 'null'::jsonb
  ) then
    raise exception 'B23 character deletion should preserve the private note body';
  end if;
end
$$;

select public.novelight_delete_private_story_note(
  current_setting('novelight.test.b23_plot_note')::bigint
);

do $$
begin
  if exists (
    select 1
      from pg_catalog.jsonb_array_elements(public.novelight_private_story_notes(797001)) note
     where note ->> 'title' = '第一部プロット'
  ) then
    raise exception 'B23 owner delete did not remove selected private note';
  end if;
end
$$;

reset role;
rollback;