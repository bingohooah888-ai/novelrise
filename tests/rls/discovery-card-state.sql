-- Bounded public card facts must not disclose unpublished or future episodes.
begin;

insert into auth.users(id, raw_user_meta_data)
values (
  '93200000-0000-0000-0000-000000000001',
  '{"display_name":"Discover Test Author"}'::jsonb
)
on conflict (id) do nothing;

insert into public.profiles(id, display_name, plan)
values (
  '93200000-0000-0000-0000-000000000001',
  'Discover Test Author',
  'standard'
)
on conflict (id) do update
set display_name = excluded.display_name;

insert into public.novels(
  id, user_id, title, description, genre, status, ai_usage,
  content_policy_ack, content_policy_version
)
overriding system value
values
  (
    932001, '93200000-0000-0000-0000-000000000001',
    'Discovery Public', 'visible', '現代ドラマ', 'published',
    'human', true, 'beta-test'
  ),
  (
    932002, '93200000-0000-0000-0000-000000000001',
    'Discovery Draft', 'private', '現代ドラマ', 'draft',
    'human', true, 'beta-test'
  );

insert into public.episodes(
  novel_id, user_id, episode_number, title, content, status,
  created_at, scheduled_publish_at
)
values
  (
    932001, '93200000-0000-0000-0000-000000000001',
    1, 'public one', 'published', 'published',
    now() - interval '3 days', null
  ),
  (
    932001, '93200000-0000-0000-0000-000000000001',
    2, 'public two', 'published', 'published',
    now() - interval '1 day', null
  ),
  (
    932001, '93200000-0000-0000-0000-000000000001',
    3, 'future scheduled', 'private', 'published',
    now(), now() + interval '2 days'
  ),
  (
    932001, '93200000-0000-0000-0000-000000000001',
    4, 'draft', 'private', 'draft',
    now(), null
  ),
  (
    932002, '93200000-0000-0000-0000-000000000001',
    1, 'draft novel episode', 'private', 'published',
    now(), null
  );

insert into public.novel_rank_state(
  novel_id_snapshot, author_id_snapshot, is_completed, completed_at
)
values (
  '932001',
  '93200000-0000-0000-0000-000000000001',
  true,
  now()
)
on conflict (novel_id_snapshot) do update
set is_completed = excluded.is_completed,
    completed_at = excluded.completed_at;

set local role anon;

do $$
declare
  v_card record;
  v_count integer;
begin
  select * into v_card
  from public.novelight_public_discovery_card_state(
    array[932001, 932002, 932001]::bigint[]
  )
  where novel_id = '932001';

  if v_card.author_name <> 'Discover Test Author'
     or v_card.is_completed is not true
     or v_card.published_episode_count <> 2
     or v_card.latest_published_at < now() - interval '25 hours'
     or v_card.latest_published_at > now() - interval '23 hours'
  then
    raise exception 'Invalid card state: %', row_to_json(v_card);
  end if;

  select count(*) into v_count
  from public.novelight_public_discovery_card_state(
    array[932001, 932002, 932001]::bigint[]
  );
  if v_count <> 1 then
    raise exception 'Private work or duplicate id leaked: %', v_count;
  end if;
end
$$;

reset role;
rollback;
