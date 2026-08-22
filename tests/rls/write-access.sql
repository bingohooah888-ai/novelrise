\set ON_ERROR_STOP on

-- Anonymous users must not be able to write content even when table privileges exist.
set role anon;

do $$
begin
  begin
    insert into public.novels (id, user_id, status) values (
      '30000000-0000-0000-0000-000000000001',
      '11111111-1111-1111-1111-111111111111',
      'published'
    );
    raise exception 'anon unexpectedly inserted a novel';
  exception
    when insufficient_privilege then null;
  end;
end
$$;

update public.novels
set status = 'draft'
where id = '10000000-0000-0000-0000-000000000001';

select public.test_assert(
  (select status = 'published' from public.novels where id = '10000000-0000-0000-0000-000000000001'),
  'anon must not update a published novel'
);

delete from public.novels
where id = '10000000-0000-0000-0000-000000000001';

select public.test_assert(
  exists (
    select 1 from public.novels
    where id = '10000000-0000-0000-0000-000000000001'
  ),
  'anon must not delete a published novel'
);

reset role;

-- Author A can create and manage only content owned by Author A.
set role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-1111-1111-111111111111',
  false
);

insert into public.novels (id, user_id, status) values (
  '30000000-0000-0000-0000-000000000001',
  '11111111-1111-1111-1111-111111111111',
  'published'
);

select public.test_assert(
  exists (
    select 1 from public.novels
    where id = '30000000-0000-0000-0000-000000000001'
      and user_id = '11111111-1111-1111-1111-111111111111'
  ),
  'author A must be able to insert an owned novel'
);

do $$
begin
  begin
    insert into public.novels (id, user_id, status) values (
      '30000000-0000-0000-0000-000000000002',
      '22222222-2222-2222-2222-222222222222',
      'published'
    );
    raise exception 'author A unexpectedly inserted a novel owned by author B';
  exception
    when insufficient_privilege then null;
  end;
end
$$;

do $$
begin
  begin
    update public.novels
    set user_id = '22222222-2222-2222-2222-222222222222'
    where id = '30000000-0000-0000-0000-000000000001';
    raise exception 'author A unexpectedly transferred novel ownership';
  exception
    when insufficient_privilege then null;
  end;
end
$$;

select public.test_assert(
  (select user_id = '11111111-1111-1111-1111-111111111111'::uuid
   from public.novels
   where id = '30000000-0000-0000-0000-000000000001'),
  'novel ownership must not be transferable through UPDATE'
);

update public.novels
set status = 'draft'
where id = '20000000-0000-0000-0000-000000000001';

select public.test_assert(
  (select status = 'published'
   from public.novels
   where id = '20000000-0000-0000-0000-000000000001'),
  'author A must not update author B novel'
);

delete from public.novels
where id = '20000000-0000-0000-0000-000000000001';

select public.test_assert(
  exists (
    select 1 from public.novels
    where id = '20000000-0000-0000-0000-000000000001'
  ),
  'author A must not delete author B novel'
);

insert into public.episodes (
  id,
  novel_id,
  user_id,
  episode_number,
  status
) values (
  '33000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  '11111111-1111-1111-1111-111111111111',
  1,
  'published'
);

select public.test_assert(
  exists (
    select 1 from public.episodes
    where id = '33000000-0000-0000-0000-000000000001'
  ),
  'author A must be able to add an episode to own novel'
);

do $$
begin
  begin
    insert into public.episodes (
      id,
      novel_id,
      user_id,
      episode_number,
      status
    ) values (
      '33000000-0000-0000-0000-000000000002',
      '20000000-0000-0000-0000-000000000001',
      '11111111-1111-1111-1111-111111111111',
      99,
      'published'
    );
    raise exception 'author A unexpectedly added an episode to author B novel';
  exception
    when insufficient_privilege then null;
  end;
end
$$;

do $$
begin
  begin
    insert into public.episodes (
      id,
      novel_id,
      user_id,
      episode_number,
      status
    ) values (
      '33000000-0000-0000-0000-000000000003',
      '30000000-0000-0000-0000-000000000001',
      '22222222-2222-2222-2222-222222222222',
      2,
      'published'
    );
    raise exception 'author A unexpectedly spoofed episode ownership';
  exception
    when insufficient_privilege then null;
  end;
end
$$;

reset role;

-- Author B cannot modify or delete Author A's published episode.
set role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '22222222-2222-2222-2222-222222222222',
  false
);

update public.episodes
set status = 'draft'
where id = '33000000-0000-0000-0000-000000000001';

select public.test_assert(
  (select status = 'published'
   from public.episodes
   where id = '33000000-0000-0000-0000-000000000001'),
  'author B must not update author A episode'
);

delete from public.episodes
where id = '33000000-0000-0000-0000-000000000001';

select public.test_assert(
  exists (
    select 1 from public.episodes
    where id = '33000000-0000-0000-0000-000000000001'
  ),
  'author B must not delete author A episode'
);

reset role;

-- Author A can update/delete own episode and delete own test novel.
set role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-1111-1111-111111111111',
  false
);

update public.episodes
set status = 'draft'
where id = '33000000-0000-0000-0000-000000000001';

select public.test_assert(
  (select status = 'draft'
   from public.episodes
   where id = '33000000-0000-0000-0000-000000000001'),
  'author A must be able to update own episode'
);

delete from public.episodes
where id = '33000000-0000-0000-0000-000000000001';

select public.test_assert(
  not exists (
    select 1 from public.episodes
    where id = '33000000-0000-0000-0000-000000000001'
  ),
  'author A must be able to delete own episode'
);

delete from public.novels
where id = '30000000-0000-0000-0000-000000000001';

select public.test_assert(
  not exists (
    select 1 from public.novels
    where id = '30000000-0000-0000-0000-000000000001'
  ),
  'author A must be able to delete own novel'
);

reset role;

select 'PASS: content write RLS blocks cross-author changes' as result;
