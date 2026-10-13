\set ON_ERROR_STOP on

do $$
begin
  if to_regclass('public.author_notes') is null
     or to_regprocedure('public.novelight_manage_my_author_notes(integer)') is null
     or to_regprocedure('public.novelight_archive_my_author_note(bigint)') is null then
    raise exception 'PRECHECK FAIL: existing author status note runtime missing';
  end if;
  if to_regprocedure('public.novelight_delete_my_author_note(bigint)') is not null then
    raise exception 'PRECHECK FAIL: delete RPC already exists';
  end if;
  raise notice 'PRECHECK PASS: owner-bound author note deletion can be installed';
end
$$;
