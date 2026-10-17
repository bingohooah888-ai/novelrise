-- Data-preserving rollback: remove the feature and write policies only.
-- Keep the public bucket and already uploaded objects for manual recovery.
begin;
do $$
begin
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists "Authors select own work cover objects" on storage.objects';
    execute 'drop policy if exists "Authors upload own work cover objects" on storage.objects';
    execute 'drop policy if exists "Authors remove own work cover objects" on storage.objects';
  end if;
end
$$;
drop table if exists public.novel_custom_covers;
commit;
