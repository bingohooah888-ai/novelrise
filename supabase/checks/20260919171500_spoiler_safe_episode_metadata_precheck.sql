\set ON_ERROR_STOP on

do $$
begin
  if to_regprocedure('public.novelight_novel_outline(bigint)') is null then
    raise exception 'Novel outline RPC is missing';
  end if;
  if to_regprocedure('public.novelight_followed_author_updates(integer)') is null then
    raise exception 'Followed-author updates RPC is missing';
  end if;
  if to_regclass('public.valid_read_events') is null then
    raise exception 'Valid-read source is missing';
  end if;
end
$$;
