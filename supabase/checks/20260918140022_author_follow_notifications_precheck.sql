-- Read-only precheck for 20260918140022_author_follow_notifications.sql

do $$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.novels') is null
     or to_regclass('public.episodes') is null
     or to_regclass('public.user_blocks') is null
     or to_regclass('public.user_mutes') is null then
    raise exception 'PRECHECK FAIL: author follow prerequisites are missing';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'novels'
       and column_name = 'first_published_at'
  ) then
    raise exception 'PRECHECK FAIL: novels.first_published_at is missing';
  end if;

  if to_regclass('public.author_follows') is not null
     or to_regclass('public.author_follow_events') is not null then
    raise exception 'PRECHECK FAIL: author follow tables already exist';
  end if;
  if to_regprocedure('public.novelight_author_follow_state(uuid)') is not null
     or to_regprocedure('public.novelight_set_author_follow(uuid,boolean)') is not null
     or to_regprocedure('public.novelight_set_author_follow_notifications(uuid,boolean,boolean)') is not null
     or to_regprocedure('public.novelight_followed_author_updates(integer)') is not null
     or to_regprocedure('public.novelight_mark_author_follow_updates_seen(uuid,bigint,bigint)') is not null
     or to_regprocedure('public.novelight_capture_author_follow_event()') is not null then
    raise exception 'PRECHECK FAIL: author follow functions already exist';
  end if;

  if exists (
    select 1 from pg_trigger
     where tgrelid in ('public.novels'::regclass, 'public.episodes'::regclass)
       and tgname in (
         'novelight_author_follow_novel_publication',
         'novelight_author_follow_episode_publication'
       )
       and not tgisinternal
  ) then
    raise exception 'PRECHECK FAIL: author follow trigger name collision';
  end if;
end
$$;

select 'PRECHECK PASS: author follow prerequisites are ready' as result;
