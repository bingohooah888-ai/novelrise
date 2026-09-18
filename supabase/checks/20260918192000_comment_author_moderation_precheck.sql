\set ON_ERROR_STOP on

do $$
declare
  v_feed_definition text;
  v_post_definition text;
begin
  if to_regclass('public.novel_comments') is null
     or to_regclass('public.novels') is null
     or to_regclass('public.profiles') is null then
    raise exception 'PRECHECK FAIL: B #14 requires comments, novels, and profiles';
  end if;

  if to_regprocedure('public.novelight_comment_feed(text,integer)') is null
     or to_regprocedure('public.post_novel_comment(text,text)') is null
     or to_regprocedure('public.delete_novel_comment(uuid)') is null then
    raise exception 'PRECHECK FAIL: B #14 comment runtime foundation is incomplete';
  end if;

  if to_regclass('public.user_mutes') is null
     or to_regclass('public.user_blocks') is null then
    raise exception 'PRECHECK FAIL: B #14 block/mute foundation is incomplete';
  end if;

  select lower(pg_catalog.pg_get_functiondef(
    'public.novelight_comment_feed(text,integer)'::regprocedure
  )) into v_feed_definition;
  select lower(pg_catalog.pg_get_functiondef(
    'public.post_novel_comment(text,text)'::regprocedure
  )) into v_post_definition;

  if position('public.user_mutes' in v_feed_definition) = 0
     or position('public.user_blocks' in v_feed_definition) = 0 then
    raise exception 'PRECHECK FAIL: comment feed is not the current block/mute-aware runtime';
  end if;

  if position('direct_interaction_unavailable' in v_post_definition) = 0
     or position('public.user_blocks' in v_post_definition) = 0 then
    raise exception 'PRECHECK FAIL: comment posting is not the current block-aware runtime';
  end if;

  if exists (
    select 1 from information_schema.columns
     where table_schema='public'
       and table_name='novel_comments'
       and column_name in (
         'author_hidden_at',
         'author_hidden_reason',
         'pinned_at',
         'author_reply_body',
         'author_reply_at',
         'author_reply_updated_at'
       )
  ) then
    raise exception 'PRECHECK FAIL: B #14 moderation columns already exist';
  end if;

  if to_regclass('public.novel_comment_moderation_events') is not null
     or to_regprocedure('public.novelight_set_comment_pin(uuid,boolean)') is not null
     or to_regprocedure('public.novelight_set_comment_hidden(uuid,boolean,text)') is not null
     or to_regprocedure('public.novelight_set_comment_author_reply(uuid,text)') is not null then
    raise exception 'PRECHECK FAIL: B #14 moderation runtime already exists';
  end if;
end
$$;

select 'PRECHECK PASS: B #14 author comment moderation prerequisites are ready' as result;
