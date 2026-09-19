\set ON_ERROR_STOP on

do $$
declare
  v_outline text;
  v_updates text;
begin
  if to_regprocedure('public.novelight_reader_episode_index(text[])') is null then
    raise exception 'Spoiler-safe reader episode index is missing';
  end if;

  select pg_get_functiondef(
    'public.novelight_novel_outline(bigint)'::regprocedure
  ) into v_outline;
  select pg_get_functiondef(
    'public.novelight_followed_author_updates(integer)'::regprocedure
  ) into v_updates;

  if pg_catalog.strpos(v_outline, 'v_reveal_through') = 0
     or pg_catalog.strpos(v_outline, 'valid_read_events') = 0 then
    raise exception 'Novel outline is not spoiler bounded';
  end if;

  if pg_catalog.strpos(v_updates, 'valid_read_events') = 0 then
    raise exception 'Followed-author updates still expose future titles';
  end if;

  if not has_function_privilege(
    'anon', 'public.novelight_reader_episode_index(text[])', 'EXECUTE'
  ) or not has_function_privilege(
    'authenticated', 'public.novelight_reader_episode_index(text[])', 'EXECUTE'
  ) then
    raise exception 'Reader episode index client grants are missing';
  end if;
end
$$;
