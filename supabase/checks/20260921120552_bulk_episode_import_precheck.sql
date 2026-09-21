-- Precheck for 20260921120552_bulk_episode_import.sql
do $$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.novels') is null
     or to_regclass('public.episodes') is null then
    raise exception 'Required profiles/novels/episodes tables are missing';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.novels'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.episodes'::regclass) then
    raise exception 'RLS must remain enabled on novels and episodes';
  end if;

  if to_regprocedure('public.novelight_import_episode_drafts(bigint,jsonb)') is null then
    raise exception 'Existing beta import RPC is missing';
  end if;

  if to_regclass('public.bulk_import_events') is not null
     or to_regprocedure('public.novelight_bulk_import_episode_drafts(bigint,jsonb)') is not null
     or to_regprocedure('public.novelight_record_bulk_import_event(text,bigint,integer)') is not null then
    raise exception 'Bulk import beta objects already exist';
  end if;
end
$$;
