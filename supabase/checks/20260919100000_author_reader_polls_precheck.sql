\set ON_ERROR_STOP on

do $$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.novels') is null
     or to_regclass('public.user_blocks') is null then
    raise exception 'PRECHECK FAIL: profiles, novels, and user_blocks are required';
  end if;
  if to_regclass('public.novel_polls') is not null
     or to_regclass('public.novel_poll_options') is not null
     or to_regclass('public.novel_poll_votes') is not null
     or to_regprocedure('public.novelight_public_novel_poll(bigint)') is not null
     or to_regprocedure('public.novelight_manage_my_novel_polls(bigint,integer)') is not null
     or to_regprocedure('public.novelight_create_my_novel_poll(bigint,text,text[])') is not null
     or to_regprocedure('public.novelight_close_my_novel_poll(bigint)') is not null
     or to_regprocedure('public.novelight_vote_novel_poll(bigint,bigint)') is not null then
    raise exception 'PRECHECK FAIL: B #20 reader poll objects already exist';
  end if;
  raise notice 'PRECHECK PASS: B #20 reader poll prerequisites are ready';
end
$$;
