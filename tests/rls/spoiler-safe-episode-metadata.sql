\set ON_ERROR_STOP on

begin;

create or replace function public.beta_audit_test_assert(
  p_condition boolean,
  p_message text
)
returns void
language plpgsql
as $$
begin
  if coalesce(p_condition, false) is not true then
    raise exception '%', p_message;
  end if;
end
$$;

insert into auth.users (id) values
  ('fa300000-0000-4000-8000-000000000001'),
  ('fa300000-0000-4000-8000-000000000002');

update public.profiles
set display_name = case id
  when 'fa300000-0000-4000-8000-000000000001'::uuid then 'Spoiler Author'
  else 'Spoiler Reader'
end,
plan = 'free'
where id in (
  'fa300000-0000-4000-8000-000000000001'::uuid,
  'fa300000-0000-4000-8000-000000000002'::uuid
);

insert into public.novels (
  id, user_id, title, description, genre, status, pv,
  ai_usage, content_rating, content_warnings,
  content_policy_ack, content_policy_version, first_published_at
) values (
  9983001,
  'fa300000-0000-4000-8000-000000000001',
  'Spoiler boundary work',
  'audit fixture',
  'ファンタジー',
  'published',
  0,
  'human',
  'general',
  '{}'::text[],
  true,
  'beta-v1',
  now()
);

insert into public.episodes (
  id, novel_id, user_id, episode_number, title, content, status
) values
  (
    9983011, 9983001,
    'fa300000-0000-4000-8000-000000000001',
    1, 'First secret title', 'body one', 'published'
  ),
  (
    9983012, 9983001,
    'fa300000-0000-4000-8000-000000000001',
    2, 'Future secret title', 'body two', 'published'
  );

set role authenticated;
select set_config(
  'request.jwt.claim.sub',
  'fa300000-0000-4000-8000-000000000002',
  false
);

select public.beta_audit_test_assert(
  (
    select count(*) = 2
       and count(*) filter (where episode_title is null) = 2
    from public.novelight_reader_episode_index(array['9983001']::text[])
  ),
  'unread reader index must expose navigation IDs and numbers without titles'
);

reset role;

insert into public.valid_read_events (
  reader_id, novel_id_snapshot, episode_id_snapshot, author_id_snapshot,
  session_id, body_char_count, progress_signal, foreground_signal,
  interaction_signal, rule_version
) values (
  'fa300000-0000-4000-8000-000000000002',
  '9983001',
  '9983011',
  'fa300000-0000-4000-8000-000000000001',
  'fa300000-0000-4000-8000-000000000003',
  1000,
  true,
  true,
  false,
  'spoiler-audit'
);

set role authenticated;
select set_config(
  'request.jwt.claim.sub',
  'fa300000-0000-4000-8000-000000000002',
  false
);

select public.beta_audit_test_assert(
  (
    select
      max(episode_title) filter (where episode_number = 1) = 'First secret title'
      and max(episode_title) filter (where episode_number = 2) is null
    from public.novelight_reader_episode_index(array['9983001']::text[])
  ),
  'reader may see reached title but not future title'
);

select public.beta_audit_test_assert(
  (
    select
      max(episode_title) filter (where episode_number = 1) = 'First secret title'
      and max(episode_title) filter (where episode_number = 2) is null
    from public.novelight_novel_outline(9983001)
  ),
  'public outline must apply the same reached-reading spoiler boundary'
);

reset role;

set role authenticated;
select set_config(
  'request.jwt.claim.sub',
  'fa300000-0000-4000-8000-000000000001',
  false
);

select public.beta_audit_test_assert(
  (
    select count(*) filter (where episode_title is not null) = 2
    from public.novelight_novel_outline(9983001)
  ),
  'author must retain full title visibility for owned work'
);

reset role;
rollback;

select 'PASS: automatic episode metadata is spoiler-bounded by qualified reading' as result;
