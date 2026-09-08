\set ON_ERROR_STOP on

-- The compact integration fixture predates episode body storage. Chapter 38
-- valid-read qualification must be tested against body length, so provide the
-- production column shape before applying the SCOUT beta foundation migration.
alter table public.episodes
  add column if not exists content text not null default '';

update public.episodes
set content = repeat('本文', 600)
where status = 'published';

-- Give each LIGHT SEED pool work a published episode so multiple readers can
-- independently qualify valid reads before testing the 6/3/2 inventory caps.
do $$
declare
  i integer;
begin
  for i in 1..24 loop
    insert into public.episodes (
      id,
      novel_id,
      user_id,
      episode_number,
      status,
      content
    ) values (
      ('71000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
      ('70000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
      '77777777-7777-7777-7777-777777777777',
      1,
      'published',
      repeat('発掘本文', 400)
    )
    on conflict do nothing;
  end loop;
end
$$;