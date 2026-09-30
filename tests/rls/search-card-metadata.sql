begin;

insert into auth.users(id, raw_user_meta_data)
values ('93100000-0000-0000-0000-000000000001', '{"display_name":"Card Author"}'::jsonb)
on conflict (id) do nothing;

insert into public.profiles(id, display_name, plan)
values ('93100000-0000-0000-0000-000000000001', 'Card Author', 'standard')
on conflict (id) do update set display_name = excluded.display_name;

insert into public.novels(
  id, user_id, title, description, genre, status, ai_usage,
  content_policy_ack, content_policy_version
)
overriding system value
values
  (931001, '93100000-0000-0000-0000-000000000001', 'Card Public', 'visible', '恋愛', 'published', 'human', true, 'beta-test'),
  (931002, '93100000-0000-0000-0000-000000000001', 'Card Draft', 'private', '恋愛', 'draft', 'human', true, 'beta-test');

insert into public.episodes(novel_id, user_id, episode_number, title, content, status)
values
  (931001, '93100000-0000-0000-0000-000000000001', 1, 'one', 'abc', 'published'),
  (931001, '93100000-0000-0000-0000-000000000001', 2, 'two', '四五六七', 'published'),
  (931001, '93100000-0000-0000-0000-000000000001', 3, 'draft', repeat('x', 100), 'draft'),
  (931002, '93100000-0000-0000-0000-000000000001', 1, 'private', repeat('x', 200), 'published');

insert into public.novel_rank_state(
  novel_id_snapshot, author_id_snapshot, is_completed, completed_at
)
values (
  '931001', '93100000-0000-0000-0000-000000000001', true, now()
)
on conflict (novel_id_snapshot) do update
set is_completed = excluded.is_completed,
    completed_at = excluded.completed_at;

insert into public.novel_custom_tags(novel_id, display_name, tag_normalized, position)
values
  (931001, '雨の日', '雨の日', 1),
  (931001, '手紙', '手紙', 2);

insert into public.novel_official_tags(novel_id, tag_id, position)
select 931001, id, 1 from public.official_tags where is_active order by sort_order, id limit 1;

set local role anon;

do $$
declare
  v_card record;
  v_count integer;
begin
  select * into v_card
  from public.novelight_search_card_metadata(array[931001, 931002, 931001]::bigint[])
  where novel_id = '931001';

  if v_card.author_name <> 'Card Author'
     or v_card.is_completed is not true
     or v_card.published_episode_count <> 2
     or v_card.published_character_count <> 7
     or v_card.custom_tag_names <> array['雨の日', '手紙']::text[]
     or cardinality(v_card.official_tag_names) <> 1 then
    raise exception 'public card metadata was not aggregated as expected: %', row_to_json(v_card);
  end if;

  select count(*) into v_count
  from public.novelight_search_card_metadata(array[931001, 931002, 931001]::bigint[]);
  if v_count <> 1 then
    raise exception 'draft novels or duplicate ids leaked into cards: % rows', v_count;
  end if;
end
$$;

reset role;
rollback;
