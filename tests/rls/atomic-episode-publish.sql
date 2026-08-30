\set ON_ERROR_STOP on

-- Exercise the current production-like schema produced by migration replay.
insert into auth.users (id, raw_user_meta_data) values
  (
    '33333333-3333-3333-3333-333333333333',
    '{"display_name":"Atomic Owner"}'::jsonb
  ),
  (
    '44444444-4444-4444-4444-444444444444',
    '{"display_name":"Atomic Other"}'::jsonb
  );

insert into public.novels (
  user_id,
  title,
  description,
  genre,
  status,
  created_at
) values (
  '33333333-3333-3333-3333-333333333333',
  'Atomic publish success',
  'Atomic publication success fixture',
  '現代ファンタジー',
  'draft',
  '2026-08-01T00:00:00Z'
);

-- The happy path runs as the real authenticated role, proving that the
-- SECURITY INVOKER function works through the existing owner RLS policies.
set role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '33333333-3333-3333-3333-333333333333',
  false
);
select public.novelight_publish_episode_atomic(
  (select id from public.novels where title = 'Atomic publish success'),
  1,
  'Atomic first episode',
  'Atomic first episode body'
);
reset role;
select set_config('request.jwt.claim.sub', '', false);

do $$
declare
  v_novel public.novels%rowtype;
begin
  select * into strict v_novel
  from public.novels
  where title = 'Atomic publish success';

  if v_novel.status <> 'published' then
    raise exception 'Atomic publish did not publish the novel';
  end if;

  if v_novel.first_published_at is null
     or v_novel.created_at <> v_novel.first_published_at then
    raise exception 'Atomic publish did not preserve first-publication timestamp contract';
  end if;

  if not exists (
    select 1
    from public.episodes e
    where e.novel_id = v_novel.id
      and e.user_id = '33333333-3333-3333-3333-333333333333'
      and e.episode_number = 1
      and e.title = 'Atomic first episode'
      and e.content = 'Atomic first episode body'
      and e.status = 'published'
      and e.pv = 0
  ) then
    raise exception 'Atomic publish did not insert the published episode';
  end if;
end
$$;

-- Seed a duplicate episode number while its novel is still draft. The RPC will
-- publish the novel first and then hit the unique constraint on episode insert;
-- the exception must roll the novel publication and trigger side effects back.
insert into public.novels (
  user_id,
  title,
  description,
  genre,
  status,
  created_at
) values (
  '33333333-3333-3333-3333-333333333333',
  'Atomic publish rollback',
  'Atomic publication rollback fixture',
  '現代ファンタジー',
  'draft',
  '2026-08-02T00:00:00Z'
);

insert into public.episodes (
  novel_id,
  user_id,
  episode_number,
  title,
  content,
  status,
  pv
)
select
  n.id,
  n.user_id,
  1,
  'Existing episode',
  'Existing body',
  'draft',
  0
from public.novels n
where n.title = 'Atomic publish rollback';

do $$
declare
  v_novel_id bigint;
  v_status text;
  v_first_published_at timestamptz;
  v_created_at timestamptz;
begin
  select id into strict v_novel_id
  from public.novels
  where title = 'Atomic publish rollback';

  perform set_config(
    'request.jwt.claim.sub',
    '33333333-3333-3333-3333-333333333333',
    true
  );

  begin
    perform public.novelight_publish_episode_atomic(
      v_novel_id,
      1,
      'Duplicate episode',
      'Must fail atomically'
    );
    raise exception 'Expected duplicate episode_number failure did not occur';
  exception
    when unique_violation then
      null;
  end;

  select status, first_published_at, created_at
  into strict v_status, v_first_published_at, v_created_at
  from public.novels
  where id = v_novel_id;

  if v_status <> 'draft' then
    raise exception 'Novel publication was not rolled back after episode insert failure';
  end if;

  if v_first_published_at is not null
     or v_created_at <> '2026-08-02T00:00:00Z'::timestamptz then
    raise exception 'First-publication timestamp side effects were not rolled back';
  end if;

  if (
    select count(*)
    from public.episodes
    where novel_id = v_novel_id
      and episode_number = 1
  ) <> 1 then
    raise exception 'Failed atomic publish changed the episode set';
  end if;

  if exists (
    select 1
    from novelrise_migration_backup.publication_created_at b
    where b.migration_id = '20260823172000'
      and b.novel_id = v_novel_id::text
  ) then
    raise exception 'First-publication backup side effect was not rolled back';
  end if;
end
$$;

-- The RPC takes no user_id argument and refuses a novel not owned by auth.uid().
do $$
declare
  v_novel_id bigint;
begin
  select id into strict v_novel_id
  from public.novels
  where title = 'Atomic publish rollback';

  perform set_config(
    'request.jwt.claim.sub',
    '44444444-4444-4444-4444-444444444444',
    true
  );

  begin
    perform public.novelight_publish_episode_atomic(
      v_novel_id,
      2,
      'Unauthorized episode',
      'Must not be inserted'
    );
    raise exception 'Expected ownership rejection did not occur';
  exception
    when insufficient_privilege then
      null;
  end;

  if exists (
    select 1
    from public.episodes
    where novel_id = v_novel_id
      and episode_number = 2
  ) then
    raise exception 'Non-owner atomic publish inserted an episode';
  end if;
end
$$;
