-- Only the disposable CI replay database. All fixture rows roll back.
begin;

insert into auth.users (id,raw_user_meta_data) values
 ('f0110000-0000-4000-8000-000000000001','{}'::jsonb),
 ('f0110000-0000-4000-8000-000000000002','{}'::jsonb),
 ('f0110000-0000-4000-8000-000000000003','{}'::jsonb)
on conflict (id) do nothing;

insert into public.profiles (id,display_name,created_at) values
 ('f0110000-0000-4000-8000-000000000001','Test Reader 1',now()),
 ('f0110000-0000-4000-8000-000000000002','Test Author 2',now()),
 ('f0110000-0000-4000-8000-000000000003','Test Reader 3',now())
on conflict (id) do update set display_name=excluded.display_name;

insert into public.author_follows
 (follower_user_id,author_user_id,notify_new_works,notify_updates) values
 ('f0110000-0000-4000-8000-000000000001',
  'f0110000-0000-4000-8000-000000000002',true,false),
 ('f0110000-0000-4000-8000-000000000003',
  'f0110000-0000-4000-8000-000000000002',false,true),
 ('f0110000-0000-4000-8000-000000000002',
  'f0110000-0000-4000-8000-000000000001',true,true);

-- An anonymous role may neither execute nor enumerate these private tables.
set local role anon;
do $anon_follow$
begin
  if pg_catalog.has_function_privilege(current_user,
       'public.novelight_followers(integer,integer)','EXECUTE')
     or pg_catalog.has_function_privilege(current_user,
       'public.novelight_followed_authors(integer,integer)','EXECUTE')
     or pg_catalog.has_function_privilege(current_user,
       'public.novelight_follow_counts()','EXECUTE') then
    raise exception 'Anonymous role can execute private follows';
  end if;
  begin
    perform public.novelight_follow_counts();
    raise exception 'Anonymous RPC execution unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end
$anon_follow$;

-- Logged-in Reader 1 sees only their own direct relationships.
set local role authenticated;
select pg_catalog.set_config(
 'request.jwt.claim.sub','f0110000-0000-4000-8000-000000000001',true);
do $reader_one_follow$
declare v_following jsonb;
        v_followers jsonb;
        v_counts jsonb;
begin
  v_following := public.novelight_followed_authors(25,0);
  v_followers := public.novelight_followers(25,0);
  v_counts := public.novelight_follow_counts();
  if pg_catalog.jsonb_array_length(v_following) <> 1
    or v_following->0->>'author_user_id' <>
         'f0110000-0000-4000-8000-000000000002'
    or v_following->0->>'notify_new_works' <> 'true'
    or v_following->0->>'notify_updates' <> 'false'
    or pg_catalog.jsonb_array_length(v_followers) <> 1
    or v_followers->0->>'user_id' <>
         'f0110000-0000-4000-8000-000000000002'
    or v_counts->>'followers' <> '1'
    or v_counts->>'following' <> '1' then
    raise exception 'Own following/follower data contract failed: %',v_counts;
  end if;
  if public.novelight_followers(25,1) <> '[]'::jsonb
    or public.novelight_followed_authors(25,1) <> '[]'::jsonb then
    raise exception 'Private pagination returned unexpected rows';
  end if;
  if v_followers->0 ? 'notify_updates' then
    raise exception 'Follower notification preferences leaked';
  end if;
end
$reader_one_follow$;

-- Logged-in Author 2 sees two followers but not unrelated Reader 3's
-- own following list or their private notification preferences.
select pg_catalog.set_config(
 'request.jwt.claim.sub','f0110000-0000-4000-8000-000000000002',true);
do $author_two_follow$
declare v_followers jsonb;
        v_counts jsonb;
begin
  v_followers := public.novelight_followers(25,0);
  v_counts := public.novelight_follow_counts();
  if pg_catalog.jsonb_array_length(v_followers) <> 2
    or v_counts->>'followers' <> '2'
    or v_counts->>'following' <> '1'
    or public.novelight_followed_authors(25,0)->0->>'author_user_id'
       <> 'f0110000-0000-4000-8000-000000000001' then
    raise exception 'Owner scope failed: %',v_counts;
  end if;
  if pg_catalog.jsonb_array_length(public.novelight_followers(1,1)) <> 1 then
    raise exception 'Paged followers are not bounded';
  end if;
end
$author_two_follow$;

-- Block must hide both the follower relationship and the aggregate count.
reset role;
insert into public.user_blocks(blocker_user_id,blocked_user_id) values
 ('f0110000-0000-4000-8000-000000000002',
  'f0110000-0000-4000-8000-000000000003');

set local role authenticated;
select pg_catalog.set_config(
 'request.jwt.claim.sub','f0110000-0000-4000-8000-000000000002',true);
do $owner_block_follow$
declare v_counts jsonb := public.novelight_follow_counts();
begin
  if v_counts->>'followers' <> '1'
    or pg_catalog.jsonb_array_length(public.novelight_followers(25,0)) <> 1 then
    raise exception 'Blocked follower was counted or enumerated';
  end if;
end
$owner_block_follow$;

select pg_catalog.set_config(
 'request.jwt.claim.sub','f0110000-0000-4000-8000-000000000003',true);
do $blocked_reader_follow$
declare v_counts jsonb := public.novelight_follow_counts();
begin
  if v_counts->>'following' <> '0'
    or public.novelight_followed_authors(25,0) <> '[]'::jsonb then
    raise exception 'Blocked author leaked to reader';
  end if;
end
$blocked_reader_follow$;

rollback;
