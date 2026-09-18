\set ON_ERROR_STOP on

begin;

insert into auth.users (id, raw_user_meta_data)
values
  ('79900000-0000-0000-0000-000000000001', '{"display_name":"B15 Author"}'::jsonb),
  ('79900000-0000-0000-0000-000000000002', '{"display_name":"B15 Reader"}'::jsonb)
on conflict (id) do nothing;

insert into public.profiles (id, display_name)
values
  ('79900000-0000-0000-0000-000000000001', 'B15 Author'),
  ('79900000-0000-0000-0000-000000000002', 'B15 Reader')
on conflict (id) do update set display_name = excluded.display_name;

insert into public.novel_thumbnail_assets (
  id, label, storage_path, image_url, created_by
)
values (
  '79900000-0000-0000-0000-000000000003',
  'B15 fixture thumbnail',
  'official/79900000-0000-0000-0000-000000000003.webp',
  'https://example.invalid/b15-fixture.webp',
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
  'B15 Spoiler Work',
  'B #15 spoiler display fixture',
  'ファンタジー',
  'published',
  0,
  'human',
  true,
  'beta-v1',
  '79900000-0000-0000-0000-000000000003'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '79900000-0000-0000-0000-000000000002',
  true
);
select set_config(
  'novelight.test.b15_spoiler',
  public.novelight_post_novel_comment(
    '799001',
    'spoiler comment',
    true
  ) ->> 'id',
  true
);
select set_config(
  'novelight.test.b15_plain',
  public.novelight_post_novel_comment(
    '799001',
    'plain comment',
    false
  ) ->> 'id',
  true
);
select set_config(
  'novelight.test.b15_legacy',
  public.post_novel_comment('799001', 'legacy comment') ->> 'id',
  true
);
reset role;
select set_config('request.jwt.claim.sub', '', true);

do $$
begin
  if not exists (
    select 1
      from public.novel_comments
     where id = current_setting('novelight.test.b15_spoiler')::uuid
       and is_spoiler = true
  ) then
    raise exception 'B #15 spoiler flag was not stored atomically';
  end if;

  if exists (
    select 1
      from public.novel_comments
     where id in (
       current_setting('novelight.test.b15_plain')::uuid,
       current_setting('novelight.test.b15_legacy')::uuid
     )
       and is_spoiler = true
  ) then
    raise exception 'Plain or legacy comments unexpectedly became spoilers';
  end if;

  if (
    select count(*)
      from public.scout_event_ledger
     where novel_id_snapshot = '799001'
       and event_type = 'comment_posted'
  ) <> 3 then
    raise exception 'B #15 changed raw comment event creation';
  end if;

  if (
    select count(*)
      from public.scout_xp_ledger x
      join public.scout_event_ledger e on e.id = x.source_event_id
     where e.novel_id_snapshot = '799001'
       and x.xp_kind = 'comment'
  ) <> 1 then
    raise exception 'B #15 changed same-work daily comment XP semantics';
  end if;
end
$$;

set local role anon;
do $$
declare
  v_feed jsonb;
begin
  v_feed := public.novelight_comment_feed('799001', 50);

  if not exists (
    select 1
      from pg_catalog.jsonb_array_elements(v_feed) e
     where e ->> 'id' = current_setting('novelight.test.b15_spoiler')
       and (e ->> 'is_spoiler')::boolean = true
       and e ->> 'body' = 'spoiler comment'
  ) then
    raise exception 'Public feed did not expose spoiler presentation state';
  end if;

  if not exists (
    select 1
      from pg_catalog.jsonb_array_elements(v_feed) e
     where e ->> 'id' = current_setting('novelight.test.b15_plain')
       and (e ->> 'is_spoiler')::boolean = false
  ) then
    raise exception 'Public feed did not preserve plain comment state';
  end if;
end
$$;
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '79900000-0000-0000-0000-000000000001',
  true
);
select public.novelight_set_user_block(
  '79900000-0000-0000-0000-000000000002',
  true
);
reset role;
select set_config('request.jwt.claim.sub', '', true);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '79900000-0000-0000-0000-000000000002',
  true
);
do $$
begin
  begin
    perform public.novelight_post_novel_comment(
      '799001',
      'blocked spoiler comment',
      true
    );
    raise exception 'B #15 unexpectedly bypassed the existing block boundary';
  exception
    when insufficient_privilege then
      if position('DIRECT_INTERACTION_UNAVAILABLE' in sqlerrm) = 0 then
        raise;
      end if;
  end;
end
$$;
reset role;
select set_config('request.jwt.claim.sub', '', true);

do $$
begin
  if not has_function_privilege(
       'authenticated',
       'public.novelight_post_novel_comment(text,text,boolean)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.novelight_post_novel_comment(text,text,boolean)',
       'EXECUTE'
     )
     or has_function_privilege(
       'service_role',
       'public.novelight_post_novel_comment(text,text,boolean)',
       'EXECUTE'
     ) then
    raise exception 'B #15 spoiler-post RPC grants are incorrect';
  end if;
end
$$;

rollback;
