begin;

insert into auth.users (id, raw_user_meta_data)
values
  ('78100000-0000-0000-0000-000000000001', '{}'::jsonb),
  ('78100000-0000-0000-0000-000000000002', '{}'::jsonb)
on conflict (id) do nothing;

insert into public.profiles (id, display_name)
values
  ('78100000-0000-0000-0000-000000000001', 'Self Comment Author'),
  ('78100000-0000-0000-0000-000000000002', 'Other Comment Author')
on conflict (id) do update set display_name = excluded.display_name;

insert into public.novel_thumbnail_assets (
  id,
  label,
  storage_path,
  image_url,
  created_by
)
values (
  '78100000-0000-0000-0000-000000000003',
  'Self comment fixture thumbnail',
  'official/78100000-0000-0000-0000-000000000003.webp',
  'https://example.invalid/self-comment-fixture.webp',
  '78100000-0000-0000-0000-000000000001'
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
    781001,
    '78100000-0000-0000-0000-000000000001',
    'Self Comment Work',
    'Owned by the commenting user',
    'ファンタジー',
    'published',
    0,
    'human',
    true,
    'beta-v1',
    '78100000-0000-0000-0000-000000000003'
  ),
  (
    781002,
    '78100000-0000-0000-0000-000000000002',
    'Other Work 1',
    'Eligible comment work 1',
    'ファンタジー',
    'published',
    0,
    'human',
    true,
    'beta-v1',
    '78100000-0000-0000-0000-000000000003'
  ),
  (
    781003,
    '78100000-0000-0000-0000-000000000002',
    'Other Work 2',
    'Eligible comment work 2',
    'ファンタジー',
    'published',
    0,
    'human',
    true,
    'beta-v1',
    '78100000-0000-0000-0000-000000000003'
  ),
  (
    781004,
    '78100000-0000-0000-0000-000000000002',
    'Other Work 3',
    'Eligible comment work 3',
    'ファンタジー',
    'published',
    0,
    'human',
    true,
    'beta-v1',
    '78100000-0000-0000-0000-000000000003'
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
  '78100000-0000-0000-0000-000000000001',
  true
);

select public.post_novel_comment('781001', 'self comment must not award EXP');
select public.post_novel_comment('781002', 'eligible work one');
select public.post_novel_comment('781003', 'eligible work two');
select public.post_novel_comment('781004', 'eligible work three');
reset role;

do $$
begin
  if (
    select count(*)
      from public.novel_comments c
     where c.user_id = '78100000-0000-0000-0000-000000000001'
  ) <> 4 then
    raise exception 'All comments, including a self-comment, must remain storable';
  end if;

  if exists (
    select 1
      from public.scout_xp_ledger x
      join public.scout_event_ledger e on e.id = x.source_event_id
     where x.user_id = '78100000-0000-0000-0000-000000000001'
       and x.xp_kind = 'comment'
       and e.novel_id_snapshot = '781001'
  ) then
    raise exception 'Self-comment awarded SCOUT EXP';
  end if;

  if (
    select count(*)
      from public.scout_xp_ledger x
     where x.user_id = '78100000-0000-0000-0000-000000000001'
       and x.xp_kind = 'comment'
  ) <> 3 then
    raise exception 'Self-comment must not consume the three-work daily EXP cap';
  end if;

  if (
    select coalesce(sum(x.xp_value), 0)
      from public.scout_xp_ledger x
     where x.user_id = '78100000-0000-0000-0000-000000000001'
       and x.xp_kind = 'comment'
  ) <> 15 then
    raise exception 'Three eligible comments after a self-comment must still award 15 XP';
  end if;

  if not exists (
    select 1
      from public.scout_event_ledger e
     where e.user_id = '78100000-0000-0000-0000-000000000001'
       and e.event_type = 'comment_posted'
       and e.novel_id_snapshot = '781001'
       and e.metadata ->> 'novel_author_id' = '78100000-0000-0000-0000-000000000001'
       and e.metadata ->> 'xp_eligible' = 'false'
  ) then
    raise exception 'Self-comment raw evidence must snapshot author and ineligibility';
  end if;

  if (
    select count(*)
      from public.scout_event_ledger e
     where e.user_id = '78100000-0000-0000-0000-000000000001'
       and e.event_type = 'comment_posted'
       and e.novel_id_snapshot in ('781002', '781003', '781004')
       and e.metadata ->> 'xp_eligible' = 'true'
  ) <> 3 then
    raise exception 'Eligible comment events must snapshot EXP eligibility';
  end if;
end
$$;

rollback;
