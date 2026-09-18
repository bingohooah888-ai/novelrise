\set ON_ERROR_STOP on

begin;

insert into auth.users (id, raw_user_meta_data)
values
  ('79000000-0000-0000-0000-000000000001', '{"display_name":"Follow Author"}'::jsonb),
  ('79000000-0000-0000-0000-000000000002', '{"display_name":"Follow Reader"}'::jsonb),
  ('79000000-0000-0000-0000-000000000003', '{"display_name":"Blocked Author"}'::jsonb)
on conflict (id) do nothing;

insert into public.profiles (id, display_name)
values
  ('79000000-0000-0000-0000-000000000001', 'Follow Author'),
  ('79000000-0000-0000-0000-000000000002', 'Follow Reader'),
  ('79000000-0000-0000-0000-000000000003', 'Blocked Author')
on conflict (id) do update set display_name = excluded.display_name;

insert into public.novel_thumbnail_assets (
  id, label, storage_path, image_url, created_by
) values (
  '79000000-0000-0000-0000-000000000004',
  'Follow fixture thumbnail',
  'official/79000000-0000-0000-0000-000000000004.webp',
  'https://example.invalid/follow-fixture.webp',
  '79000000-0000-0000-0000-000000000001'
)
on conflict (id) do nothing;
insert into public.novels (
  id, user_id, title, description, genre, status, pv, ai_usage,
  content_policy_ack, content_policy_version, thumbnail_asset_id
)
overriding system value
values (
  790001,
  '79000000-0000-0000-0000-000000000001',
  'Existing Follow Work',
  'Existing before follow',
  'ファンタジー',
  'published',
  0,
  'human',
  true,
  'beta-v1',
  '79000000-0000-0000-0000-000000000004'
);

insert into public.episodes (
  id, novel_id, user_id, episode_number, title, content, status, pv
)
overriding system value
values (
  790001,
  790001,
  '79000000-0000-0000-0000-000000000001',
  1,
  'Existing first episode',
  'Existing body',
  'published',
  0
);
-- Following establishes a baseline at the current event cursor. Historical
-- publications must not arrive as a backlog.
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '79000000-0000-0000-0000-000000000002',
  true
);
select public.novelight_set_author_follow(
  '79000000-0000-0000-0000-000000000001',
  true
);
do $$
begin
  if pg_catalog.jsonb_array_length(
    public.novelight_followed_author_updates(50)
  ) <> 0 then
    raise exception 'Historical publications leaked into a new follow';
  end if;
end
$$;
reset role;

-- A work first published after the follow appears as one new-work event.
insert into public.novels (
  id, user_id, title, description, genre, status, pv, ai_usage,
  content_policy_ack, content_policy_version, thumbnail_asset_id
)
overriding system value
values (
  790002,
  '79000000-0000-0000-0000-000000000001',
  'New Follow Work',
  'Published after follow',
  'ファンタジー',
  'published',
  0,
  'human',
  true,
  'beta-v1',
  '79000000-0000-0000-0000-000000000004'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '79000000-0000-0000-0000-000000000002',
  true
);
do $$
declare
  v_updates jsonb := public.novelight_followed_author_updates(50);
begin
  if pg_catalog.jsonb_array_length(v_updates) <> 1
     or v_updates -> 0 ->> 'event_type' <> 'novel_published'
     or v_updates -> 0 ->> 'novel_title' <> 'New Follow Work' then
    raise exception 'New-work notification was not returned exactly once';
  end if;
end
$$;

select (
  public.novelight_followed_author_updates(50) -> 0 ->> 'event_id'
)::bigint as new_work_event_id
\gset
select public.novelight_mark_author_follow_updates_seen(
  '79000000-0000-0000-0000-000000000001',
  :'new_work_event_id'::bigint,
  null
);
reset role;
-- Episode 1 is part of the new-work publication and must not generate a
-- duplicate update notification.
insert into public.episodes (
  id, novel_id, user_id, episode_number, title, content, status, pv
)
overriding system value
values (
  790002,
  790002,
  '79000000-0000-0000-0000-000000000001',
  1,
  'First episode',
  'First body',
  'published',
  0
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '79000000-0000-0000-0000-000000000002',
  true
);
do $$
begin
  if pg_catalog.jsonb_array_length(
    public.novelight_followed_author_updates(50)
  ) <> 0 then
    raise exception 'Episode 1 created a duplicate update notification';
  end if;
end
$$;
reset role;

-- Later episodes create update events.
insert into public.episodes (
  id, novel_id, user_id, episode_number, title, content, status, pv
)
overriding system value
values (
  790003,
  790002,
  '79000000-0000-0000-0000-000000000001',
  2,
  'Second episode',
  'Second body',
  'published',
  0
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '79000000-0000-0000-0000-000000000002',
  true
);
do $$
declare
  v_updates jsonb := public.novelight_followed_author_updates(50);
begin
  if pg_catalog.jsonb_array_length(v_updates) <> 1
     or v_updates -> 0 ->> 'event_type' <> 'episode_published'
     or (v_updates -> 0 ->> 'episode_number')::bigint <> 2 then
    raise exception 'Episode update notification is missing or malformed';
  end if;
end
$$;

select public.novelight_set_author_follow_notifications(
  '79000000-0000-0000-0000-000000000001',
  true,
  false
);
reset role;
-- Updates published while that category is disabled stay hidden.
insert into public.episodes (
  id, novel_id, user_id, episode_number, title, content, status, pv
)
overriding system value
values (
  790004,
  790002,
  '79000000-0000-0000-0000-000000000001',
  3,
  'Third episode',
  'Third body',
  'published',
  0
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '79000000-0000-0000-0000-000000000002',
  true
);
do $$
begin
  if pg_catalog.jsonb_array_length(
    public.novelight_followed_author_updates(50)
  ) <> 0 then
    raise exception 'Disabled update category still returned notifications';
  end if;
end
$$;

-- Re-enabling baselines to the current cursor rather than surfacing backlog.
select public.novelight_set_author_follow_notifications(
  '79000000-0000-0000-0000-000000000001',
  true,
  true
);
do $$
begin
  if pg_catalog.jsonb_array_length(
    public.novelight_followed_author_updates(50)
  ) <> 0 then
    raise exception 'Re-enabled update category surfaced disabled-period backlog';
  end if;
end
$$;
reset role;

insert into public.episodes (
  id, novel_id, user_id, episode_number, title, content, status, pv
)
overriding system value
values (
  790005,
  790002,
  '79000000-0000-0000-0000-000000000001',
  4,
  'Fourth episode',
  'Fourth body',
  'published',
  0
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '79000000-0000-0000-0000-000000000002',
  true
);
select (
  public.novelight_followed_author_updates(50) -> 0 ->> 'event_id'
)::bigint as update_event_id
\gset
select public.novelight_mark_author_follow_updates_seen(
  '79000000-0000-0000-0000-000000000001',
  null,
  :'update_event_id'::bigint
);
do $$
begin
  if pg_catalog.jsonb_array_length(
    public.novelight_followed_author_updates(50)
  ) <> 0 then
    raise exception 'Acknowledged author update remained unread';
  end if;
end
$$;
reset role;

-- Muting the author suppresses future followed-author feed items without
-- changing work ranking or deleting notification evidence.
insert into public.user_mutes (muter_user_id, muted_user_id)
values (
  '79000000-0000-0000-0000-000000000002',
  '79000000-0000-0000-0000-000000000001'
);

insert into public.episodes (
  id, novel_id, user_id, episode_number, title, content, status, pv
)
overriding system value
values (
  790006,
  790002,
  '79000000-0000-0000-0000-000000000001',
  5,
  'Fifth episode',
  'Fifth body',
  'published',
  0
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '79000000-0000-0000-0000-000000000002',
  true
);
do $$
begin
  if pg_catalog.jsonb_array_length(
    public.novelight_followed_author_updates(50)
  ) <> 0 then
    raise exception 'Muted author remained visible in followed-author feed';
  end if;
end
$$;
reset role;

-- A bilateral block prevents creation of a new follow.
insert into public.user_blocks (blocker_user_id, blocked_user_id)
values (
  '79000000-0000-0000-0000-000000000003',
  '79000000-0000-0000-0000-000000000002'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '79000000-0000-0000-0000-000000000002',
  true
);
do $$
begin
  begin
    perform public.novelight_set_author_follow(
      '79000000-0000-0000-0000-000000000003',
      true
    );
    raise exception 'Blocked follow unexpectedly succeeded';
  exception
    when insufficient_privilege then
      null;
  end;
end
$$;
reset role;
do $$
begin
  if has_table_privilege(
    'authenticated', 'public.author_follows', 'SELECT'
  ) or has_table_privilege(
    'authenticated', 'public.author_follows', 'INSERT'
  ) or has_table_privilege(
    'authenticated', 'public.author_follow_events', 'SELECT'
  ) or has_table_privilege(
    'authenticated', 'public.author_follow_events', 'INSERT'
  ) then
    raise exception 'Raw author-follow tables became client-accessible';
  end if;

  if (
    select count(*)
      from public.author_follow_events e
     where e.episode_id = 790002
  ) <> 0 then
    raise exception 'Episode 1 event exists despite duplicate suppression';
  end if;

  if not exists (
    select 1
      from public.author_follow_events e
     where e.episode_id = 790005
       and e.event_type = 'episode_published'
  ) then
    raise exception 'Expected publication evidence was not retained';
  end if;
end
$$;

rollback;
