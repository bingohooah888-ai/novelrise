\set ON_ERROR_STOP on

do $$
begin
  if to_regclass('public.profiles') is null or to_regclass('public.novels') is null then
    raise exception 'PRECHECK FAIL: profiles and novels are required';
  end if;
  if to_regclass('public.author_notes') is not null
     or to_regprocedure('public.novelight_public_author_notes(uuid,integer)') is not null
     or to_regprocedure('public.novelight_manage_my_author_notes(integer)') is not null
     or to_regprocedure('public.novelight_save_my_author_note(bigint,text,text,bigint)') is not null
     or to_regprocedure('public.novelight_archive_my_author_note(bigint)') is not null then
    raise exception 'PRECHECK FAIL: #19 author notes objects already exist';
  end if;
  raise notice 'PRECHECK PASS: author notes prerequisites are ready';
end
$$;
