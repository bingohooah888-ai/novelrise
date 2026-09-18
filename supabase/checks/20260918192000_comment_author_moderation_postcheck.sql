\set ON_ERROR_STOP on

do $$
declare
  v_fun regprocedure;
  v_security_definer boolean;
  v_config text[];
  v_comment text;
  v_feed_definition text;
  v_post_definition text;
begin
  foreach v_fun in array array[
    'public.novelight_set_comment_pin(uuid,boolean)'::regprocedure,
    'public.novelight_set_comment_hidden(uuid,boolean,text)'::regprocedure,
    'public.novelight_set_comment_author_reply(uuid,text)'::regprocedure
  ]
  loop
    select p.prosecdef, p.proconfig
      into v_security_definer, v_config
      from pg_proc p
     where p.oid = v_fun;

    if not v_security_definer then
      raise exception 'POSTCHECK FAIL: moderation RPC % must remain SECURITY DEFINER', v_fun;
    end if;

    if v_config is null
       or coalesce(pg_catalog.array_to_string(v_config, ','), '')
            not like '%search_path=""%' then
      raise exception 'POSTCHECK FAIL: moderation RPC % must pin empty search_path', v_fun;
    end if;

    if not has_function_privilege('authenticated', v_fun, 'EXECUTE')
       or has_function_privilege('anon', v_fun, 'EXECUTE')
       or has_function_privilege('service_role', v_fun, 'EXECUTE') then
      raise exception 'POSTCHECK FAIL: moderation RPC % execute grants are too broad/narrow', v_fun;
    end if;
  end loop;

  if to_regclass('public.novel_comment_moderation_events') is null then
    raise exception 'POSTCHECK FAIL: moderation audit table is missing';
  end if;

  if not coalesce((
    select c.relrowsecurity
      from pg_class c
     where c.oid='public.novel_comment_moderation_events'::regclass
  ), false) then
    raise exception 'POSTCHECK FAIL: moderation audit table RLS is disabled';
  end if;

  if has_table_privilege('authenticated','public.novel_comment_moderation_events','SELECT')
     or has_table_privilege('authenticated','public.novel_comment_moderation_events','INSERT')
     or has_table_privilege('authenticated','public.novel_comment_moderation_events','UPDATE')
     or has_table_privilege('authenticated','public.novel_comment_moderation_events','DELETE')
     or has_table_privilege('anon','public.novel_comment_moderation_events','SELECT')
     or has_table_privilege('service_role','public.novel_comment_moderation_events','SELECT') then
    raise exception 'POSTCHECK FAIL: raw moderation audit table is directly accessible';
  end if;

  if not exists (
    select 1
      from pg_indexes
     where schemaname='public'
       and tablename='novel_comments'
       and indexname='novel_comments_one_visible_pin_per_novel_idx'
       and indexdef ilike '%unique%'
  ) then
    raise exception 'POSTCHECK FAIL: one-pin-per-work unique index is missing';
  end if;

  if not has_function_privilege('anon','public.novelight_comment_feed(text,integer)','EXECUTE')
     or not has_function_privilege('authenticated','public.novelight_comment_feed(text,integer)','EXECUTE') then
    raise exception 'POSTCHECK FAIL: comment feed grants were not preserved';
  end if;

  select lower(pg_catalog.pg_get_functiondef(
    'public.novelight_comment_feed(text,integer)'::regprocedure
  )) into v_feed_definition;
  select lower(pg_catalog.pg_get_functiondef(
    'public.post_novel_comment(text,text)'::regprocedure
  )) into v_post_definition;

  if position('can_moderate' in v_feed_definition) = 0
     or position('author_reply_visible' in v_feed_definition) = 0
     or position('author_hidden_at' in v_feed_definition) = 0
     or position('public.user_mutes' in v_feed_definition) = 0
     or position('public.user_blocks' in v_feed_definition) = 0 then
    raise exception 'POSTCHECK FAIL: B #14 feed contract or block/mute filtering is missing';
  end if;

  if position('direct_interaction_unavailable' in v_post_definition) = 0
     or position('public.user_blocks' in v_post_definition) = 0 then
    raise exception 'POSTCHECK FAIL: existing blocked-comment posting contract was lost';
  end if;

  select obj_description(
    'public.novel_comment_moderation_events'::regclass,
    'pg_class'
  ) into v_comment;

  if v_comment is null
     or position('Not an evaluation, Rank, SCOUT, discovery, or exposure signal' in v_comment)=0 then
    raise exception 'POSTCHECK FAIL: moderation neutrality contract comment is missing';
  end if;

  if not exists (
    select 1
      from information_schema.columns
     where table_schema='public'
       and table_name='novel_comments'
       and column_name='author_hidden_at'
  ) or not exists (
    select 1
      from information_schema.columns
     where table_schema='public'
       and table_name='novel_comments'
       and column_name='author_reply_body'
  ) or not exists (
    select 1
      from information_schema.columns
     where table_schema='public'
       and table_name='novel_comments'
       and column_name='pinned_at'
  ) then
    raise exception 'POSTCHECK FAIL: comment moderation state columns are incomplete';
  end if;
end
$$;

select 'POSTCHECK PASS: B #14 moderation is owner-only, audited, soft, and evaluation-neutral' as result;
