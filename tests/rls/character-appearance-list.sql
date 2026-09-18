\set ON_ERROR_STOP on

begin;

insert into auth.users (id, raw_user_meta_data)
values
  ('79900000-0000-0000-0000-000000000001', '{"display_name":"Character Author"}'::jsonb),
  ('79900000-0000-0000-0000-000000000002', '{"display_name":"Character Other"}'::jsonb)
on conflict (id) do nothing;

insert into public.profiles (id, display_name)
values
  ('79900000-0000-0000-0000-000000000001', 'Character Author'),
  ('79900000-0000-0000-0000-000000000002', 'Character Other')
on conflict (id) do update set display_name=excluded.display_name;

insert into public.novel_thumbnail_assets (
  id, label, storage_path, image_url, created_by
)
values (
  '79900000-0000-0000-0000-000000000003',
  'Character fixture thumbnail',
  'official/79900000-0000-0000-0000-000000000003.webp',
  'https://example.invalid/character-fixture.webp',
  '79900000-0000-0000-0000-000000000001'
)
on conflict (id) do nothing;

insert into public.novels (
  id, user_id, title, description, genre, status, pv, ai_usage,
  content_policy_ack, content_policy_version, thumbnail_asset_id
)
overriding system value
values (
  799001,
  '79900000-0000-0000-0000-000000000001',
  'Character Appearance Work',
  'Character appearance fixture',
  'ファンタジー',
  'published',
  0,
  'human',
  true,
  'beta-v1',
  '79900000-0000-0000-0000-000000000003'
);

insert into public.episodes (
  id, novel_id, user_id, episode_number, title, content, status, pv
)
overriding system value
values
  (
    799011, 799001, '79900000-0000-0000-0000-000000000001',
    1, 'First', '蒼真は門をくぐった。秘密人物も遠くにいた。', 'published', 0
  ),
  (
    799012, 799001, '79900000-0000-0000-0000-000000000001',
    2, 'Second', '九条彩音が蒼真に声をかけた。', 'published', 0
  ),
  (
    799013, 799001, '79900000-0000-0000-0000-000000000001',
    3, 'Draft future', '未来人が登場する。', 'draft', 0
  );

set local role authenticated;
select set_config('request.jwt.claim.sub','79900000-0000-0000-0000-000000000001',true);

select set_config(
  'novelight.test.character_soma',
  public.novelight_upsert_character(
    799001, null, '桐谷蒼真', array['蒼真','ソーマ'], true, true
  ) ->> 'character_id',
  true
);
select set_config(
  'novelight.test.character_ayane',
  public.novelight_upsert_character(
    799001, null, '九条彩音', array['彩音'], true, true
  ) ->> 'character_id',
  true
);
select set_config(
  'novelight.test.character_hidden',
  public.novelight_upsert_character(
    799001, null, '秘密人物', '{}'::text[], true, false
  ) ->> 'character_id',
  true
);
select set_config(
  'novelight.test.character_future',
  public.novelight_upsert_character(
    799001, null, '未来人', '{}'::text[], true, true
  ) ->> 'character_id',
  true
);
select set_config(
  'novelight.test.character_guide',
  public.novelight_upsert_character(
    799001, null, '案内人', '{}'::text[], true, true
  ) ->> 'character_id',
  true
);

do $$
declare
  v_list jsonb;
  v_editor jsonb;
begin
  v_list := public.novelight_author_character_list(799001);
  if pg_catalog.jsonb_array_length(v_list) <> 5 then
    raise exception 'Author character registry did not return all registered characters';
  end if;

  if not exists (
    select 1 from pg_catalog.jsonb_array_elements(v_list) item
     where item ->> 'name' = '桐谷蒼真'
       and (item ->> 'latest_episode_number')::integer = 2
  ) then
    raise exception 'Alias detection did not rescan existing episodes';
  end if;

  v_editor := public.novelight_episode_character_editor(799011);
  if not exists (
    select 1 from pg_catalog.jsonb_array_elements(v_editor) item
     where item ->> 'name' = '桐谷蒼真'
       and (item ->> 'auto_detected')::boolean
       and (item ->> 'effective')::boolean
  ) then
    raise exception 'Episode editor did not expose automatic appearance state';
  end if;
end
$$;

-- Non-owner cannot mutate another author's character registry.
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role authenticated;
select set_config('request.jwt.claim.sub','79900000-0000-0000-0000-000000000002',true);
do $$
begin
  begin
    perform public.novelight_upsert_character(
      799001, null, 'Intruder', '{}'::text[], true, true
    );
    raise exception 'Non-owner unexpectedly created a character';
  exception
    when insufficient_privilege then null;
  end;
end
$$;

-- Raw registry is not directly readable even by authenticated users.
do $$
declare
  v_count bigint;
begin
  begin
    execute 'select count(*) from public.novel_characters' into v_count;
    raise exception 'Authenticated role unexpectedly read raw character registry';
  exception
    when insufficient_privilege then null;
  end;
end
$$;

reset role;
select set_config('request.jwt.claim.sub','',true);

-- Episode 1 feed must not leak episode 2 or draft-future characters.
set local role anon;
do $$
declare
  v_feed jsonb;
begin
  v_feed := public.novelight_character_feed(799011);

  if pg_catalog.jsonb_array_length(v_feed) <> 1
     or v_feed -> 0 ->> 'name' <> '桐谷蒼真'
     or (v_feed -> 0 ->> 'appears_current_episode')::boolean <> true then
    raise exception 'Episode 1 feed did not contain only the visible current character';
  end if;

  if exists (
    select 1 from pg_catalog.jsonb_array_elements(v_feed) item
     where item ? 'aliases'
        or item ->> 'name' in ('九条彩音','秘密人物','未来人')
  ) then
    raise exception 'Reader feed leaked aliases, hidden characters, or future characters';
  end if;
end
$$;
reset role;

-- Manual include/exclude must override automatic detection.
set local role authenticated;
select set_config('request.jwt.claim.sub','79900000-0000-0000-0000-000000000001',true);
select public.novelight_set_character_episode_override(
  current_setting('novelight.test.character_soma')::bigint,
  799011,
  'exclude'
);
select public.novelight_set_character_episode_override(
  current_setting('novelight.test.character_guide')::bigint,
  799011,
  'include'
);
reset role;
select set_config('request.jwt.claim.sub','',true);

set local role anon;
do $$
declare
  v_feed jsonb;
begin
  v_feed := public.novelight_character_feed(799011);
  if pg_catalog.jsonb_array_length(v_feed) <> 1
     or v_feed -> 0 ->> 'name' <> '案内人'
     or (v_feed -> 0 ->> 'appears_current_episode')::boolean <> true then
    raise exception 'Manual include/exclude did not override automatic detection';
  end if;
end
$$;
reset role;

-- Returning to auto restores the content-derived state.
set local role authenticated;
select set_config('request.jwt.claim.sub','79900000-0000-0000-0000-000000000001',true);
select public.novelight_set_character_episode_override(
  current_setting('novelight.test.character_soma')::bigint,
  799011,
  'auto'
);
select public.novelight_set_character_episode_override(
  current_setting('novelight.test.character_guide')::bigint,
  799011,
  'auto'
);
reset role;
select set_config('request.jwt.claim.sub','',true);

-- Editing episode content must refresh auto detection through the single episode trigger.
update public.episodes
   set content='誰もいない門だった。'
 where id=799011;

set local role anon;
do $$
declare
  v_feed jsonb;
begin
  v_feed := public.novelight_character_feed(799011);
  if pg_catalog.jsonb_array_length(v_feed) <> 0 then
    raise exception 'Episode body edit left stale automatic character appearance';
  end if;
end
$$;
reset role;

-- Episode 2 can reveal only characters whose effective appearance is now known by episode 2.
set local role anon;
do $$
declare
  v_feed jsonb;
begin
  v_feed := public.novelight_character_feed(799012);

  if not exists (
    select 1 from pg_catalog.jsonb_array_elements(v_feed) item
     where item ->> 'name' = '桐谷蒼真'
       and (item ->> 'appears_current_episode')::boolean
  ) or not exists (
    select 1 from pg_catalog.jsonb_array_elements(v_feed) item
     where item ->> 'name' = '九条彩音'
       and (item ->> 'appears_current_episode')::boolean
  ) then
    raise exception 'Episode 2 feed did not reveal current characters';
  end if;

  if exists (
    select 1 from pg_catalog.jsonb_array_elements(v_feed) item
     where item ->> 'name' = '未来人'
  ) then
    raise exception 'Draft future character leaked into a published reader feed';
  end if;
end
$$;
reset role;

rollback;
