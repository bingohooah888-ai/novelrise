\set ON_ERROR_STOP on

-- NOVELIGHT: fail closed unless the ownership/RLS contract required by the
-- atomic episode publication RPC is present.
do $$
begin
  if to_regclass('public.novels') is null
     or to_regclass('public.episodes') is null then
    raise exception 'Required novels/episodes tables are missing';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.novels'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.episodes'::regclass) then
    raise exception 'RLS must be enabled on novels and episodes';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'novels'
      and policyname = 'novelrise_novels_update_owner'
      and cmd = 'UPDATE'
  ) then
    raise exception 'Owner UPDATE policy for novels is missing';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'episodes'
      and policyname = 'novelrise_episodes_insert_owner'
      and cmd = 'INSERT'
  ) then
    raise exception 'Owner INSERT policy for episodes is missing';
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.novels'::regclass
      and tgname = 'novels_lock_first_publication_time'
      and not tgisinternal
  ) then
    raise exception 'First-publication timestamp trigger is missing';
  end if;

  if to_regprocedure(
    'public.novelight_publish_episode_atomic(bigint,bigint,text,text)'
  ) is not null then
    raise exception 'novelight_publish_episode_atomic already exists';
  end if;
end
$$;
