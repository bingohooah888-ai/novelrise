\set ON_ERROR_STOP on

insert into auth.users (id, raw_user_meta_data) values
  (
    '55555555-5555-5555-5555-555555555555',
    '{"display_name":"Schedule Owner"}'::jsonb
  ),
  (
    '66666666-6666-6666-6666-666666666666',
    '{"display_name":"Schedule Other"}'::jsonb
  );

insert into public.novel_thumbnail_assets (
  id,
  label,
  storage_path,
  image_url,
  is_active
) values (
  '22222222-2222-2222-2222-222222222222',
  'Schedule official thumbnail',
  'official/22222222-2222-2222-2222-222222222222.webp',
  'https://example.com/schedule-official-thumbnail.webp',
  true
);

insert into public.novels (
  user_id,
  title,
  description,
  genre,
  status,
  created_at,
  ai_usage,
  content_policy_ack,
  content_policy_version,
  thumbnail_asset_id
) values (
  '55555555-5555-5555-5555-555555555555',
  'Scheduled first publication',
  'Scheduled publication fixture',
  '現代ファンタジー',
  'draft',
  '2026-09-01T00:00:00Z',
  'human',
  true,
  'beta-2026-08-23',
  '22222222-2222-2222-2222-222222222222'
), (
  '55555555-5555-5555-5555-555555555555',
  'Invalid first scheduled episode',
  'Episode two cannot be the first publication',
  '現代ファンタジー',
  'draft',
  '2026-09-01T00:00:00Z',
  'human',
  true,
  'beta-2026-08-23',
  '22222222-2222-2222-2222-222222222222'
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
select n.id, n.user_id, 1, 'Scheduled episode one', 'Scheduled body one', 'draft', 0
from public.novels n
where n.title = 'Scheduled first publication';

insert into public.episodes (
  novel_id,
  user_id,
  episode_number,
  title,
  content,
  status,
  pv
)
select n.id, n.user_id, 2, 'Invalid first episode', 'Must not be scheduled first', 'draft', 0
from public.novels n
where n.title = 'Invalid first scheduled episode';

-- A non-owner cannot schedule another author's draft.
set role authenticated;
select set_config('request.jwt.claim.sub', '66666666-6666-6666-6666-666666666666', false);
do $$
declare
  v_episode_id bigint;
begin
  select e.id into strict v_episode_id
    from public.episodes e
    join public.novels n on n.id = e.novel_id
   where n.title = 'Scheduled first publication';

  begin
    perform public.novelight_schedule_episode_draft(v_episode_id, now() + interval '10 minutes');
    raise exception 'Expected schedule ownership rejection did not occur';
  exception
    when insufficient_privilege then
      null;
  end;
end
$$;
reset role;
select set_config('request.jwt.claim.sub', '', false);

-- The owner can schedule a complete private draft.
set role authenticated;
select set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', false);
select public.novelight_schedule_episode_draft(
  (select e.id from public.episodes e join public.novels n on n.id = e.novel_id where n.title = 'Scheduled first publication'),
  now() + interval '10 minutes'
);
reset role;
select set_config('request.jwt.claim.sub', '', false);

do $$
begin
  if not exists (
    select 1
      from public.episodes e
      join public.novels n on n.id = e.novel_id
     where n.title = 'Scheduled first publication'
       and e.status = 'draft'
       and e.scheduled_publish_at > now()
  ) then
    raise exception 'Owner schedule did not persist on the private draft';
  end if;
end
$$;

-- Scheduled drafts stay invisible to anonymous readers.
set role anon;
do $$
declare
  v_count integer;
begin
  select count(*) into v_count
    from public.episodes e
    join public.novels n on n.id = e.novel_id
   where n.title = 'Scheduled first publication';
  if v_count <> 0 then
    raise exception 'Anonymous reader can see a scheduled private draft';
  end if;
end
$$;
reset role;

-- An unpublished work still has to publish episode 1 first.
set role authenticated;
select set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', false);
do $$
declare
  v_episode_id bigint;
begin
  select e.id into strict v_episode_id
    from public.episodes e
    join public.novels n on n.id = e.novel_id
   where n.title = 'Invalid first scheduled episode';

  begin
    perform public.novelight_schedule_episode_draft(v_episode_id, now() + interval '10 minutes');
    raise exception 'Expected first-episode scheduling rejection did not occur';
  exception
    when invalid_parameter_value then
      null;
  end;
end
$$;
reset role;
select set_config('request.jwt.claim.sub', '', false);

-- Simulate the database clock reaching the scheduled time, then run the same
-- internal function invoked by pg_cron. The first episode publishes both work
-- and episode and clears the schedule atomically.
update public.episodes e
   set scheduled_publish_at = now() - interval '1 minute'
  from public.novels n
 where n.id = e.novel_id
   and n.title = 'Scheduled first publication';

select public.novelight_publish_due_episode_schedules();

do $$
declare
  v_novel public.novels%rowtype;
begin
  select * into strict v_novel
    from public.novels
   where title = 'Scheduled first publication';

  if v_novel.status <> 'published'
     or v_novel.first_published_at is null
     or v_novel.created_at <> v_novel.first_published_at then
    raise exception 'Due scheduler did not preserve first-publication contract';
  end if;

  if not exists (
    select 1
      from public.episodes e
     where e.novel_id = v_novel.id
       and e.episode_number = 1
       and e.status = 'published'
       and e.scheduled_publish_at is null
  ) then
    raise exception 'Due scheduler did not publish and clear the scheduled episode';
  end if;
end
$$;

-- Manual publication remains available and must cancel the pending schedule.
insert into public.episodes (
  novel_id,
  user_id,
  episode_number,
  title,
  content,
  status,
  pv
)
select n.id, n.user_id, 2, 'Manual before schedule', 'Manual publish body', 'draft', 0
from public.novels n
where n.title = 'Scheduled first publication';

set role authenticated;
select set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', false);
select public.novelight_schedule_episode_draft(
  (select e.id from public.episodes e join public.novels n on n.id = e.novel_id where n.title = 'Scheduled first publication' and e.episode_number = 2),
  now() + interval '10 minutes'
);
select public.novelight_publish_episode_draft_atomic(
  (select e.id from public.episodes e join public.novels n on n.id = e.novel_id where n.title = 'Scheduled first publication' and e.episode_number = 2)
);
reset role;
select set_config('request.jwt.claim.sub', '', false);

do $$
begin
  if not exists (
    select 1
      from public.episodes e
      join public.novels n on n.id = e.novel_id
     where n.title = 'Scheduled first publication'
       and e.episode_number = 2
       and e.status = 'published'
       and e.scheduled_publish_at is null
  ) then
    raise exception 'Manual draft publication did not clear pending schedule';
  end if;
end
$$;

-- If an author edits a scheduled draft into an incomplete state, the due job
-- cancels the schedule rather than publishing invalid content or retrying forever.
insert into public.episodes (
  novel_id,
  user_id,
  episode_number,
  title,
  content,
  status,
  pv
)
select n.id, n.user_id, 3, 'Will become invalid', 'Valid before scheduling', 'draft', 0
from public.novels n
where n.title = 'Scheduled first publication';

set role authenticated;
select set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', false);
select public.novelight_schedule_episode_draft(
  (select e.id from public.episodes e join public.novels n on n.id = e.novel_id where n.title = 'Scheduled first publication' and e.episode_number = 3),
  now() + interval '10 minutes'
);
select public.novelight_save_episode_draft(
  (select id from public.novels where title = 'Scheduled first publication'),
  (select e.id from public.episodes e join public.novels n on n.id = e.novel_id where n.title = 'Scheduled first publication' and e.episode_number = 3),
  3,
  '',
  'Still private'
);
reset role;
select set_config('request.jwt.claim.sub', '', false);

update public.episodes e
   set scheduled_publish_at = now() - interval '1 minute'
  from public.novels n
 where n.id = e.novel_id
   and n.title = 'Scheduled first publication'
   and e.episode_number = 3;

select public.novelight_publish_due_episode_schedules();

do $$
begin
  if not exists (
    select 1
      from public.episodes e
      join public.novels n on n.id = e.novel_id
     where n.title = 'Scheduled first publication'
       and e.episode_number = 3
       and e.status = 'draft'
       and e.scheduled_publish_at is null
  ) then
    raise exception 'Invalid due draft was not safely cancelled';
  end if;
end
$$;