do $$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.novels') is null
     or to_regclass('public.episodes') is null
     or to_regclass('public.user_blocks') is null then
    raise exception 'PRECHECK FAIL: B #22 foundations missing';
  end if;

  if not (select relrowsecurity from pg_class where oid='public.novels'::regclass)
     or not (select relrowsecurity from pg_class where oid='public.episodes'::regclass) then
    raise exception 'PRECHECK FAIL: novels/episodes RLS disabled';
  end if;

  if to_regclass('public.novel_collaborators') is not null
     or to_regclass('public.novel_collaboration_invites') is not null
     or to_regclass('public.novel_collaboration_events') is not null then
    raise exception 'PRECHECK FAIL: B #22 tables already exist';
  end if;

  if to_regprocedure('public.novelight_collaboration_access(bigint)') is not null
     or to_regprocedure('public.novelight_accept_collaboration_invite(text)') is not null
     or to_regprocedure('public.novelight_update_collaboration_episode(bigint,text,text)') is not null then
    raise exception 'PRECHECK FAIL: B #22 RPCs already exist';
  end if;
end
$$;
