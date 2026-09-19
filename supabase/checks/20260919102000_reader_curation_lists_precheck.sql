\set ON_ERROR_STOP on

do $$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.novels') is null then
    raise exception 'PRECHECK FAIL: B #21 prerequisites missing';
  end if;
  if to_regclass('public.reader_curation_lists') is not null
     or to_regclass('public.reader_curation_list_items') is not null
     or to_regprocedure('public.novelight_public_reader_curation(uuid)') is not null then
    raise exception 'PRECHECK FAIL: B #21 runtime already exists';
  end if;
  raise notice 'PRECHECK PASS: B #21 reader curation can be installed';
end
$$;
