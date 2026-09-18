\set ON_ERROR_STOP on

begin;

insert into auth.users (id, raw_user_meta_data)
values
  ('79700000-0000-0000-0000-000000000001', '{"display_name":"Batch Schedule Owner"}'::jsonb),
  ('79700000-0000-0000-0000-000000000002', '{"display_name":"Batch Schedule Other"}'::jsonb)
on conflict (id) do nothing;

insert into public.profiles (id, display_name)
values
  ('79700000-0000-0000-0000-000000000001', 'Batch Schedule Owner'),
  ('79700000-0000-0000-0000-000000000002', 'Batch Schedule Other')
on conflict (id) do update set display_name = excluded.display_name;

insert into public.novel_thumbnail_assets (
  id,
  label,
  storage_path,
  image_url,
  created_by
)
values (
  '79700000-0000-0000-0000-000000000003',
  'Batch schedule fixture thumbnail',
  'official/79700000-0000-0000-0000-000000000003.webp',
  'https://example.invalid/batch-schedule-fixture.webp',
  '79700000-0000-0000-0000-000000000001'
)
on conflict (id) do nothing;

insert into public.novels (
  id,
  user_id,
  title,
  description,
  genre,
  status,
  created_at,
  pv,
  ai_usage,
  content_policy_ack,
  content_policy_version,
  thumbnail_asset_id
)
overriding system value
values (
  797001,
  '79700000-0000-0000-0000-000000000001',
  'Batch scheduled unpublished work',
  'B #13 multi-episode schedule fixture',
  'ファンタジー',
  'draft',
  '2026-09-01T00:00:00Z',
  0,
  'human',
  true,
  'beta-v1',
  '79700000-0000-0000-0000-000000000003'
);

insert into public.episodes (
  id,
  novel_id,
  user_id,
  episode_number,
  title,
  content,
  status,
  pv
)
overriding system value
values
  (
    797011,
    797001,
    '79700000-0000-0000-0000-000000000001',
    1,
    'Batch episode one',
    'Episode one body',
    'draft',
    0
  ),
  (
    797012,
    797001,
    '79700000-0000-0000-0000-000000000001',
    2,
    'Batch episode two',
    'Episode two body',
    'draft',
    0
  ),
  (
    797013,
    797001,
    '79700000-0000-0000-0000-000000000001',
    3,
    'Batch episode three',
    'Episode three body',
    'draft',
    0
  );

-- A non-owner cannot modify another author's schedule batch.
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '79700000-0000-0000-0000-000000000002',
  true
);
do $$
begin
  begin
    perform public.novelight_batch_manage_episode_schedules(
      797001,
      jsonb_build_array(
        jsonb_build_object(
          'episode_id', 797011,
          'publish_at', (now() + interval '10 minutes')::text
        )
      )
    );
    raise exception 'Other author unexpectedly changed batch schedules';
  exception
    when insufficient_privilege then
      null;
  end;
end
$$;

reset role;
select set_config('request.jwt.claim.sub', '', true);

-- The owner can schedule episode 1 and later episodes atomically even before
-- the work has ever been published, provided episode 1 is strictly earliest.
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '79700000-0000-0000-0000-000000000001',
  true
);
select public.novelight_batch_manage_episode_schedules(
  797001,
  jsonb_build_array(
    jsonb_build_object(
      'episode_id', 797011,
      'publish_at', (now() + interval '10 minutes')::text
    ),
    jsonb_build_object(
      'episode_id', 797012,
      'publish_at', (now() + interval '20 minutes')::text
    )
  )
);
reset role;
select set_config('request.jwt.claim.sub', '', true);

do $$
declare
  v_first timestamptz;
  v_second timestamptz;
begin
  select scheduled_publish_at into strict v_first
    from public.episodes
   where id = 797011;
  select scheduled_publish_at into strict v_second
    from public.episodes
   where id = 797012;

  if v_first is null or v_second is null or v_second <= v_first then
    raise exception 'Initial batch schedule did not persist in strict order';
  end if;

  if exists (
    select 1
      from public.episodes
     where id in (797011, 797012)
       and status <> 'draft'
  ) then
    raise exception 'Batch scheduling published a draft before its due time';
  end if;
end
$$;

-- Scheduled drafts remain invisible to anonymous readers.
set local role anon;
do $$
declare
  v_count integer;
begin
  select count(*) into v_count
    from public.episodes
   where id in (797011, 797012);
  if v_count <> 0 then
    raise exception 'Anonymous reader can see B #13 scheduled drafts';
  end if;
end
$$;
reset role;

-- An invalid same-time timetable for an unpublished work fails atomically and
-- leaves the previously valid schedule unchanged.
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '79700000-0000-0000-0000-000000000001',
  true
);
do $$
declare
  v_first_before timestamptz;
  v_second_before timestamptz;
begin
  select scheduled_publish_at into strict v_first_before
    from public.episodes
   where id = 797011;
  select scheduled_publish_at into strict v_second_before
    from public.episodes
   where id = 797012;

  begin
    perform public.novelight_batch_manage_episode_schedules(
      797001,
      jsonb_build_array(
        jsonb_build_object(
          'episode_id', 797011,
          'publish_at', (now() + interval '30 minutes')::text
        ),
        jsonb_build_object(
          'episode_id', 797012,
          'publish_at', (now() + interval '30 minutes')::text
        )
      )
    );
    raise exception 'Same-time unpublished schedule unexpectedly succeeded';
  exception
    when invalid_parameter_value then
      null;
  end;

  if (select scheduled_publish_at from public.episodes where id = 797011)
       is distinct from v_first_before
     or (select scheduled_publish_at from public.episodes where id = 797012)
       is distinct from v_second_before then
    raise exception 'Rejected timetable partially mutated existing schedules';
  end if;
end
$$;
reset role;
select set_config('request.jwt.claim.sub', '', true);

-- Cancelling episode 1 alone while episode 2 remains scheduled is rejected and
-- the statement rollback preserves both reservations.
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '79700000-0000-0000-0000-000000000001',
  true
);
do $$
declare
  v_first_before timestamptz;
begin
  select scheduled_publish_at into strict v_first_before
    from public.episodes
   where id = 797011;

  begin
    perform public.novelight_batch_manage_episode_schedules(
      797001,
      jsonb_build_array(
        jsonb_build_object('episode_id', 797011, 'publish_at', null)
      )
    );
    raise exception 'Episode 1 cancellation unexpectedly left a later first release';
  exception
    when invalid_parameter_value then
      null;
  end;

  if (select scheduled_publish_at from public.episodes where id = 797011)
       is distinct from v_first_before then
    raise exception 'Rejected episode 1 cancellation mutated the schedule';
  end if;
end
$$;
reset role;
select set_config('request.jwt.claim.sub', '', true);

-- Cancelling the whole selected timetable in one batch succeeds.
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '79700000-0000-0000-0000-000000000001',
  true
);
select public.novelight_batch_manage_episode_schedules(
  797001,
  jsonb_build_array(
    jsonb_build_object('episode_id', 797011, 'publish_at', null),
    jsonb_build_object('episode_id', 797012, 'publish_at', null)
  )
);
reset role;
select set_config('request.jwt.claim.sub', '', true);

do $$
begin
  if exists (
    select 1
      from public.episodes
     where id in (797011, 797012)
       and scheduled_publish_at is not null
  ) then
    raise exception 'Batch cancellation left a selected schedule behind';
  end if;
end
$$;

-- Duplicate episode identifiers and oversized payloads are rejected before any
-- mutation is committed.
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '79700000-0000-0000-0000-000000000001',
  true
);
do $$
begin
  begin
    perform public.novelight_batch_manage_episode_schedules(
      797001,
      jsonb_build_array(
        jsonb_build_object('episode_id', 797011, 'publish_at', null),
        jsonb_build_object('episode_id', 797011, 'publish_at', null)
      )
    );
    raise exception 'Duplicate episode IDs unexpectedly succeeded';
  exception
    when invalid_parameter_value then
      null;
  end;

  begin
    perform public.novelight_batch_manage_episode_schedules(
      797001,
      (
        select jsonb_agg(
          jsonb_build_object('episode_id', 900000 + value, 'publish_at', null)
        )
        from generate_series(1, 51) as g(value)
      )
    );
    raise exception 'Oversized batch unexpectedly succeeded';
  exception
    when invalid_parameter_value then
      null;
  end;
end
$$;
reset role;
select set_config('request.jwt.claim.sub', '', true);

-- Recreate a valid two-episode timetable and exercise the existing due worker.
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '79700000-0000-0000-0000-000000000001',
  true
);
select public.novelight_batch_manage_episode_schedules(
  797001,
  jsonb_build_array(
    jsonb_build_object(
      'episode_id', 797011,
      'publish_at', (now() + interval '10 minutes')::text
    ),
    jsonb_build_object(
      'episode_id', 797012,
      'publish_at', (now() + interval '20 minutes')::text
    )
  )
);
reset role;
select set_config('request.jwt.claim.sub', '', true);

update public.episodes
   set scheduled_publish_at = now() - interval '1 minute'
 where id = 797011;

select public.novelight_publish_due_episode_schedules();

do $$
begin
  if not exists (
    select 1
      from public.novels
     where id = 797001
       and status = 'published'
  ) then
    raise exception 'Existing due worker did not publish the work from episode 1';
  end if;

  if not exists (
    select 1
      from public.episodes
     where id = 797011
       and status = 'published'
       and scheduled_publish_at is null
  ) then
    raise exception 'Existing due worker did not publish batch-scheduled episode 1';
  end if;

  if not exists (
    select 1
      from public.episodes
     where id = 797012
       and status = 'draft'
       and scheduled_publish_at > now()
  ) then
    raise exception 'Later batch-scheduled episode did not remain private after episode 1';
  end if;
end
$$;

update public.episodes
   set scheduled_publish_at = now() - interval '1 minute'
 where id = 797012;

select public.novelight_publish_due_episode_schedules();

do $$
begin
  if not exists (
    select 1
      from public.episodes
     where id = 797012
       and status = 'published'
       and scheduled_publish_at is null
  ) then
    raise exception 'Existing due worker did not publish batch-scheduled episode 2';
  end if;
end
$$;

-- Once the work is published, multiple later drafts may intentionally share a
-- publication minute.
insert into public.episodes (
  id,
  novel_id,
  user_id,
  episode_number,
  title,
  content,
  status,
  pv
)
overriding system value
values
  (
    797014,
    797001,
    '79700000-0000-0000-0000-000000000001',
    4,
    'Batch episode four',
    'Episode four body',
    'draft',
    0
  ),
  (
    797015,
    797001,
    '79700000-0000-0000-0000-000000000001',
    5,
    'Batch episode five',
    'Episode five body',
    'draft',
    0
  );

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '79700000-0000-0000-0000-000000000001',
  true
);
select public.novelight_batch_manage_episode_schedules(
  797001,
  jsonb_build_array(
    jsonb_build_object(
      'episode_id', 797014,
      'publish_at', (now() + interval '30 minutes')::text
    ),
    jsonb_build_object(
      'episode_id', 797015,
      'publish_at', (now() + interval '30 minutes')::text
    )
  )
);
reset role;
select set_config('request.jwt.claim.sub', '', true);

do $$
begin
  if (
    select count(*)
      from public.episodes
     where id in (797014, 797015)
       and status = 'draft'
       and scheduled_publish_at is not null
  ) <> 2 then
    raise exception 'Published-work same-time batch schedule did not persist';
  end if;
end
$$;

rollback;
