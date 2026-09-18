-- Read-only postcheck for 20260918140022_author_follow_notifications.sql

do $$
declare
  v_name text;
begin
  if to_regclass('public.author_follows') is null
     or to_regclass('public.author_follow_events') is null then
    raise exception 'POSTCHECK FAIL: author follow tables are missing';
  end if;

  if not coalesce(
    (select relrowsecurity from pg_class where oid = 'public.author_follows'::regclass),
    false
  ) or not coalesce(
    (select relrowsecurity from pg_class where oid = 'public.author_follow_events'::regclass),
    false
  ) then
    raise exception 'POSTCHECK FAIL: RLS is not enabled';
  end if;

  if has_table_privilege('anon', 'public.author_follows', 'SELECT')
     or has_table_privilege('anon', 'public.author_follows', 'INSERT')
     or has_table_privilege('anon', 'public.author_follows', 'UPDATE')
     or has_table_privilege('anon', 'public.author_follows', 'DELETE')
     or has_table_privilege('authenticated', 'public.author_follows', 'SELECT')
     or has_table_privilege('authenticated', 'public.author_follows', 'INSERT')
     or has_table_privilege('authenticated', 'public.author_follows', 'UPDATE')
     or has_table_privilege('authenticated', 'public.author_follows', 'DELETE') then
    raise exception 'POSTCHECK FAIL: raw author_follows table is client-accessible';
  end if;
  if has_table_privilege('anon', 'public.author_follow_events', 'SELECT')
     or has_table_privilege('anon', 'public.author_follow_events', 'INSERT')
     or has_table_privilege('anon', 'public.author_follow_events', 'UPDATE')
     or has_table_privilege('anon', 'public.author_follow_events', 'DELETE')
     or has_table_privilege('authenticated', 'public.author_follow_events', 'SELECT')
     or has_table_privilege('authenticated', 'public.author_follow_events', 'INSERT')
     or has_table_privilege('authenticated', 'public.author_follow_events', 'UPDATE')
     or has_table_privilege('authenticated', 'public.author_follow_events', 'DELETE') then
    raise exception 'POSTCHECK FAIL: raw author_follow_events table is client-accessible';
  end if;

  if has_sequence_privilege('anon', 'public.author_follow_events_id_seq', 'USAGE')
     or has_sequence_privilege('authenticated', 'public.author_follow_events_id_seq', 'USAGE') then
    raise exception 'POSTCHECK FAIL: event identity sequence is client-accessible';
  end if;

  if to_regprocedure('public.novelight_author_follow_state(uuid)') is null
     or to_regprocedure('public.novelight_set_author_follow(uuid,boolean)') is null
     or to_regprocedure('public.novelight_set_author_follow_notifications(uuid,boolean,boolean)') is null
     or to_regprocedure('public.novelight_followed_author_updates(integer)') is null
     or to_regprocedure('public.novelight_mark_author_follow_updates_seen(uuid,bigint,bigint)') is null
     or to_regprocedure('public.novelight_capture_author_follow_event()') is null then
    raise exception 'POSTCHECK FAIL: author follow functions are missing';
  end if;
  if has_function_privilege('anon', 'public.novelight_author_follow_state(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.novelight_set_author_follow(uuid,boolean)', 'EXECUTE')
     or has_function_privilege('anon', 'public.novelight_set_author_follow_notifications(uuid,boolean,boolean)', 'EXECUTE')
     or has_function_privilege('anon', 'public.novelight_followed_author_updates(integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.novelight_mark_author_follow_updates_seen(uuid,bigint,bigint)', 'EXECUTE') then
    raise exception 'POSTCHECK FAIL: anonymous follow RPC access exists';
  end if;

  if not has_function_privilege('authenticated', 'public.novelight_author_follow_state(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.novelight_set_author_follow(uuid,boolean)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.novelight_set_author_follow_notifications(uuid,boolean,boolean)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.novelight_followed_author_updates(integer)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.novelight_mark_author_follow_updates_seen(uuid,bigint,bigint)', 'EXECUTE') then
    raise exception 'POSTCHECK FAIL: authenticated follow RPC grants are incomplete';
  end if;

  if has_function_privilege('anon', 'public.novelight_capture_author_follow_event()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.novelight_capture_author_follow_event()', 'EXECUTE') then
    raise exception 'POSTCHECK FAIL: trigger function is client-executable';
  end if;
  foreach v_name in array array[
    'novelight_author_follow_state',
    'novelight_set_author_follow',
    'novelight_set_author_follow_notifications',
    'novelight_followed_author_updates',
    'novelight_mark_author_follow_updates_seen',
    'novelight_capture_author_follow_event'
  ]
  loop
    if not exists (
      select 1
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname = v_name
         and p.prosecdef
         and coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=""%'
    ) then
      raise exception 'POSTCHECK FAIL: function % is not hardened', v_name;
    end if;
  end loop;

  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.novels'::regclass
       and tgname = 'novelight_author_follow_novel_publication'
       and not tgisinternal
  ) or not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.episodes'::regclass
       and tgname = 'novelight_author_follow_episode_publication'
       and not tgisinternal
  ) then
    raise exception 'POSTCHECK FAIL: publication capture triggers are missing';
  end if;
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public'
       and indexname = 'author_follow_events_novel_once_idx'
  ) or not exists (
    select 1 from pg_indexes
     where schemaname = 'public'
       and indexname = 'author_follow_events_episode_once_idx'
  ) or not exists (
    select 1 from pg_indexes
     where schemaname = 'public'
       and indexname = 'author_follow_events_author_cursor_idx'
  ) then
    raise exception 'POSTCHECK FAIL: author follow event indexes are missing';
  end if;

  if pg_get_functiondef('public.novelight_followed_author_updates(integer)'::regprocedure)
     not like '%user_mutes%'
     or pg_get_functiondef('public.novelight_followed_author_updates(integer)'::regprocedure)
     not like '%user_blocks%'
     or pg_get_functiondef('public.novelight_followed_author_updates(integer)'::regprocedure)
     not like '%n.status = ''published''%'
     or pg_get_functiondef('public.novelight_followed_author_updates(integer)'::regprocedure)
     not like '%ep.status = ''published''%' then
    raise exception 'POSTCHECK FAIL: visibility safety filters are incomplete';
  end if;

  if pg_get_functiondef('public.novelight_set_author_follow(uuid,boolean)'::regprocedure)
     not like '%DIRECT_INTERACTION_UNAVAILABLE%'
     or pg_get_functiondef('public.novelight_set_author_follow(uuid,boolean)'::regprocedure)
     not like '%max(e.id)%' then
    raise exception 'POSTCHECK FAIL: follow safety or baseline behavior is incomplete';
  end if;
end
$$;

select 'POSTCHECK PASS: author follows are private, block-aware, and notification-only' as result;
