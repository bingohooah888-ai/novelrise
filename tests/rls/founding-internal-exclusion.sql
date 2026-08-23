\set ON_ERROR_STOP on

select public.test_assert(
  exists (
    select 1
      from public.founding_author_exclusions e
     where e.user_id = '77777777-7777-7777-7777-777777777777'
  ),
  'known internal test account is excluded by immutable user ID'
);

select public.test_assert(
  not exists (
    select 1
      from public.founding_authors f
     where f.author_id = '77777777-7777-7777-7777-777777777777'
  ),
  'internal test account no longer consumes a Founding Author slot'
);

select public.test_assert(
  exists (
    select 1
      from public.founding_author_exclusion_audit a
     where a.author_id = '77777777-7777-7777-7777-777777777777'
       and a.founding_number = 1
  ),
  'removed internal assignment is retained in a private rollback audit'
);

insert into public.novels (
  id,user_id,title,genre,description,status,pv,created_at,
  ai_usage,content_rating,content_warnings,content_policy_ack,content_policy_version
) values (
  '99000000-0000-0000-0000-000000000003','77777777-7777-7777-7777-777777777777',
  'Internal smoke work','SF','must never consume founding slot','draft',0,now(),
  'human','general','{}'::text[],true,'beta-test'
);

update public.novels set status='published'
where id='99000000-0000-0000-0000-000000000003';

select public.test_assert(
  not exists (
    select 1
      from public.founding_authors f
     where f.author_id = '77777777-7777-7777-7777-777777777777'
  ),
  'future publications by an excluded internal account remain ineligible'
);

delete from public.novels
where id='99000000-0000-0000-0000-000000000003';
