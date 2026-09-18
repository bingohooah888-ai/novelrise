\set ON_ERROR_STOP on

do $$
declare
  v_feed_definition text;
  v_post_definition text;
begin
  if to_regclass('public.novel_comments') is null
     or to_regclass('public.user_mutes') is null
     or to_regclass('public.user_blocks') is null then
    raise exception 'PRECHECK FAIL: B #15 comment safety foundation is incomplete';
  end if;

  if to_regprocedure('public.post_novel_comment(text,text)') is null
     or to_regprocedure('public.novelight_comment_feed(text,integer)') is null
     or to_regprocedure('public.novelight_set_comment_hidden(uuid,boolean,text)') is null then
    raise exception 'PRECHECK FAIL: B #15 requires the current B #14 comment runtime';
  end if;

  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'novel_comments'
       and column_name = 'author_hidden_at'
  ) then
    raise exception 'PRECHECK FAIL: B #14 moderation state is missing';
  end if;

  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'novel_comments'
       and column_name = 'is_spoiler'
  ) or to_regprocedure(
    'public.novelight_post_novel_comment(text,text,boolean)'
  ) is not null then
    raise exception 'PRECHECK FAIL: B #15 spoiler runtime already exists';
  end if;

  select lower(pg_catalog.pg_get_functiondef(
    'public.novelight_comment_feed(text,integer)'::regprocedure
  )) into v_feed_definition;
  select lower(pg_catalog.pg_get_functiondef(
    'public.post_novel_comment(text,text)'::regprocedure
  )) into v_post_definition;

  if position('author_hidden_at' in v_feed_definition) = 0
     or position('author_reply_visible' in v_feed_definition) = 0
     or position('public.user_mutes' in v_feed_definition) = 0
     or position('public.user_blocks' in v_feed_definition) = 0 then
    raise exception 'PRECHECK FAIL: B #14 feed safety contract is missing';
  end if;

  if position('direct_interaction_unavailable' in v_post_definition) = 0
     or position('public.user_blocks' in v_post_definition) = 0 then
    raise exception 'PRECHECK FAIL: blocked-comment posting contract is missing';
  end if;
end
$$;

select 'PRECHECK PASS: B #15 comment spoiler prerequisites are ready' as result;
