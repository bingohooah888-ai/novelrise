\set ON_ERROR_STOP on

do $$
declare
  v_fun regprocedure := 'public.novelight_post_novel_comment(text,text,boolean)'::regprocedure;
  v_security_definer boolean;
  v_config text[];
  v_spoiler_nullable text;
  v_spoiler_default text;
  v_spoiler_comment text;
  v_post_definition text;
  v_feed_definition text;
begin
  select p.prosecdef, p.proconfig
    into v_security_definer, v_config
    from pg_proc p
   where p.oid = v_fun;

  if not v_security_definer then
    raise exception 'POSTCHECK FAIL: B #15 post RPC must remain SECURITY DEFINER';
  end if;

  if v_config is null
     or coalesce(pg_catalog.array_to_string(v_config, ','), '')
          not like '%search_path=""%' then
    raise exception 'POSTCHECK FAIL: B #15 post RPC must pin empty search_path';
  end if;

  if not has_function_privilege('authenticated', v_fun, 'EXECUTE')
     or has_function_privilege('anon', v_fun, 'EXECUTE')
     or has_function_privilege('service_role', v_fun, 'EXECUTE') then
    raise exception 'POSTCHECK FAIL: B #15 post RPC grants are too broad/narrow';
  end if;

  if not has_function_privilege(
       'authenticated',
       'public.post_novel_comment(text,text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.post_novel_comment(text,text)',
       'EXECUTE'
     ) then
    raise exception 'POSTCHECK FAIL: legacy comment-post grants changed';
  end if;

  select is_nullable, column_default
    into v_spoiler_nullable, v_spoiler_default
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'novel_comments'
     and column_name = 'is_spoiler';

  if v_spoiler_nullable is distinct from 'NO'
     or coalesce(v_spoiler_default, '') not like '%false%' then
    raise exception 'POSTCHECK FAIL: spoiler flag must be NOT NULL DEFAULT false';
  end if;

  select lower(pg_catalog.pg_get_functiondef(v_fun))
    into v_post_definition;
  select lower(pg_catalog.pg_get_functiondef(
    'public.novelight_comment_feed(text,integer)'::regprocedure
  )) into v_feed_definition;

  if position('public.post_novel_comment' in v_post_definition) = 0
     or position('set is_spoiler = v_is_spoiler' in v_post_definition) = 0 then
    raise exception 'POSTCHECK FAIL: B #15 did not preserve atomic legacy posting';
  end if;

  if position('is_spoiler' in v_feed_definition) = 0
     or position('author_hidden_at' in v_feed_definition) = 0
     or position('author_reply_visible' in v_feed_definition) = 0
     or position('public.user_mutes' in v_feed_definition) = 0
     or position('public.user_blocks' in v_feed_definition) = 0 then
    raise exception 'POSTCHECK FAIL: spoiler feed lost existing safety/moderation behavior';
  end if;

  select col_description(
    'public.novel_comments'::regclass,
    (
      select ordinal_position
        from information_schema.columns
       where table_schema = 'public'
         and table_name = 'novel_comments'
         and column_name = 'is_spoiler'
    )
  ) into v_spoiler_comment;

  if v_spoiler_comment is null
     or position('presentation-only' in v_spoiler_comment) = 0
     or position(
       'Never used for SCOUT, Rank, PV, favorites, discovery, or exposure'
       in v_spoiler_comment
     ) = 0 then
    raise exception 'POSTCHECK FAIL: spoiler neutrality contract comment is missing';
  end if;
end
$$;

select 'POSTCHECK PASS: B #15 spoiler state is atomic, reader-safe, and evaluation-neutral' as result;
