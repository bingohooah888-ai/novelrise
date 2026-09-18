\set ON_ERROR_STOP on

do $$
declare
  v_novel_policy text;
  v_episode_policy text;
begin
  if to_regclass('public.novels') is null
     or to_regclass('public.episodes') is null
     or to_regclass('public.profiles') is null then
    raise exception 'PRECHECK FAIL: B #16 core content tables are missing';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.novels'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.episodes'::regclass) then
    raise exception 'PRECHECK FAIL: novels/episodes RLS must remain enabled';
  end if;

  select pg_get_expr(polqual, polrelid)
    into v_novel_policy
    from pg_policy
   where polrelid = 'public.novels'::regclass
     and polname = 'novelrise_novels_select_published_or_owner';

  select pg_get_expr(polqual, polrelid)
    into v_episode_policy
    from pg_policy
   where polrelid = 'public.episodes'::regclass
     and polname = 'novelrise_episodes_select_published_or_novel_owner';

  if v_novel_policy is null
     or position('published' in lower(v_novel_policy)) = 0
     or v_episode_policy is null
     or position('published' in lower(v_episode_policy)) = 0 then
    raise exception 'PRECHECK FAIL: existing public-vs-owner RLS contract is missing';
  end if;

  if to_regprocedure('pg_catalog.sha256(bytea)') is null then
    raise exception 'PRECHECK FAIL: pg_catalog.sha256(bytea) is unavailable';
  end if;

  if to_regclass('public.novel_share_links') is not null
     or to_regprocedure('public.novelight_share_link_status(bigint)') is not null
     or to_regprocedure('public.novelight_rotate_share_link(bigint)') is not null
     or to_regprocedure('public.novelight_revoke_share_link(bigint)') is not null
     or to_regprocedure('public.novelight_shared_novel(text)') is not null
     or to_regprocedure('public.novelight_shared_episode(text,bigint)') is not null then
    raise exception 'PRECHECK FAIL: B #16 limited-share runtime already exists';
  end if;
end
$$;

select 'PRECHECK PASS: B #16 draft-only limited sharing prerequisites are ready' as result;
