begin;

insert into auth.users (id, raw_user_meta_data)
values
  ('78000000-0000-0000-0000-000000000001', '{}'::jsonb),
  ('78000000-0000-0000-0000-000000000002', '{}'::jsonb)
on conflict (id) do nothing;

insert into public.profiles (id, display_name)
values
  ('78000000-0000-0000-0000-000000000001', 'Comment Author'),
  ('78000000-0000-0000-0000-000000000002', 'Comment Reader')
on conflict (id) do update set display_name = excluded.display_name;

insert into public.novel_thumbnail_assets (
  id,
  label,
  storage_path,
  image_url,
  created_by
)
values (
  '78000000-0000-0000-0000-000000000003',
  'Comment fixture thumbnail',
  'official/78000000-0000-0000-0000-000000000003.webp',
  'https://example.invalid/comment-fixture.webp',
  '78000000-0000-0000-0000-000000000001'
)
on conflict (id) do nothing;

insert into public.novels (
  id,
  user_id,
  title,
  description,
  genre,
  status,
  pv,
  ai_usage,
  content_policy_ack,
  content_policy_version,
  thumbnail_asset_id
)
overriding system value
values
  (
    780001,
    '78000000-0000-0000-0000-000000000001',
    'Comment Work 1',
    'Comment fixture work 1',
    'ファンタジー',
    'published',
    0,
    'human',
    true,
    'beta-v1',
    '78000000-0000-0000-0000-000000000003'
  ),
  (
    780002,
    '78000000-0000-0000-0000-000000000001',
    'Comment Work 2',
    'Comment fixture work 2',
    'ファンタジー',
    'published',
    0,
    'human',
    true,
    'beta-v1',
    '78000000-0000-0000-0000-000000000003'
  ),
  (
    780003,
    '78000000-0000-0000-0000-000000000001',
    'Comment Work 3',
    'Comment fixture work 3',
    'ファンタジー',
    'published',
    0,
    'human',
    true,
    'beta-v1',
    '78000000-0000-0000-0000-000000000003'
  ),
  (
    780004,
    '78000000-0000-0000-0000-000000000001',
    'Comment Work 4',
    'Comment fixture work 4',
    'ファンタジー',
    'published',
    0,
    'human',
    true,
    'beta-v1',
    '78000000-0000-0000-0000-000000000003'
  )
on conflict (id) do update
  set user_id = excluded.user_id,
      title = excluded.title,
      description = excluded.description,
      genre = excluded.genre,
      status = excluded.status,
      pv = excluded.pv,
      ai_usage = excluded.ai_usage,
      content_policy_ack = excluded.content_policy_ack,
      content_policy_version = excluded.content_policy_version,
      thumbnail_asset_id = excluded.thumbnail_asset_id;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '78000000-0000-0000-0000-000000000002',
  true
);

select (public.post_novel_comment('780001', 'first comment') ->> 'id') as first_comment_id \gset
select public.post_novel_comment('780001', 'second comment on same work');
select public.post_novel_comment('780002', 'second rewarded work');
select public.post_novel_comment('780003', 'third rewarded work');
select public.post_novel_comment('780004', 'fourth work still accepts comments');

reset role;

do $$
begin
  if (select count(*) from public.novel_comments where user_id = '78000000-0000-0000-0000-000000000002') <> 5 then
    raise exception 'Comment RPC did not persist all accepted comments';
  end if;

  if (select count(*) from public.scout_xp_ledger where user_id = '78000000-0000-0000-0000-000000000002' and xp_kind = 'comment') <> 3 then
    raise exception 'Comment XP must reward exactly three works per JST day';
  end if;

  if (select coalesce(sum(xp_value), 0) from public.scout_xp_ledger where user_id = '78000000-0000-0000-0000-000000000002' and xp_kind = 'comment') <> 15 then
    raise exception 'Comment XP total must be 15 after three rewarded works';
  end if;

  if exists (
    select 1
      from public.scout_xp_ledger x
      join public.scout_event_ledger e on e.id = x.source_event_id
     where x.user_id = '78000000-0000-0000-0000-000000000002'
       and x.xp_kind = 'comment'
       and e.novel_id_snapshot = '780004'
  ) then
    raise exception 'Fourth work of the JST day must not award comment XP';
  end if;

  if (
    select count(*)
      from public.scout_xp_ledger x
      join public.scout_event_ledger e on e.id = x.source_event_id
     where x.user_id = '78000000-0000-0000-0000-000000000002'
       and x.xp_kind = 'comment'
       and e.novel_id_snapshot = '780001'
  ) <> 1 then
    raise exception 'Same work must award comment XP only once per JST day';
  end if;
end
$$;

set local role anon;
select public.novelight_comment_feed('780001', 50);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '78000000-0000-0000-0000-000000000002',
  true
);
select public.delete_novel_comment(:'first_comment_id'::uuid);
select public.post_novel_comment('780001', 'replacement after delete');
reset role;

do $$
begin
  if (select count(*) from public.scout_xp_ledger where user_id = '78000000-0000-0000-0000-000000000002' and xp_kind = 'comment') <> 3 then
    raise exception 'Delete and repost must not create additional comment XP';
  end if;

  if (select count(*) from public.scout_event_ledger where user_id = '78000000-0000-0000-0000-000000000002' and event_type = 'comment_posted') <> 6 then
    raise exception 'Raw comment_posted history is incomplete';
  end if;

  if (select count(*) from public.scout_event_ledger where user_id = '78000000-0000-0000-0000-000000000002' and event_type = 'comment_deleted') <> 1 then
    raise exception 'Raw comment_deleted history is incomplete';
  end if;

  if (select count(*) from public.novel_comments where user_id = '78000000-0000-0000-0000-000000000002' and deleted_at is null) <> 5 then
    raise exception 'Soft delete must hide only the deleted comment';
  end if;

  if has_table_privilege('authenticated', 'public.novel_comments', 'SELECT')
     or has_table_privilege('authenticated', 'public.novel_comments', 'INSERT')
     or has_table_privilege('authenticated', 'public.novel_comments', 'UPDATE')
     or has_table_privilege('authenticated', 'public.novel_comments', 'DELETE') then
    raise exception 'Authenticated clients must not receive direct comment-table privileges';
  end if;
end
$$;

rollback;
