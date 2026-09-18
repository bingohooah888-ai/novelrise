\set ON_ERROR_STOP on

do $$
begin
  if to_regclass('public.novels') is null
     or to_regclass('public.episodes') is null
     or to_regclass('public.profiles') is null then
    raise exception 'Character appearance prerequisites are incomplete';
  end if;

  if not exists (
    select 1
      from information_schema.columns
     where table_schema='public'
       and table_name='episodes'
       and column_name='content'
  ) then
    raise exception 'Character appearance requires public.episodes.content';
  end if;

  if to_regclass('public.novel_characters') is not null
     or to_regclass('public.novel_character_episode_states') is not null
     or to_regprocedure('public.novelight_upsert_character(bigint,bigint,text,text[],boolean,boolean)') is not null
     or to_regprocedure('public.novelight_character_feed(bigint)') is not null then
    raise exception 'Character appearance migration appears already applied; do not replay it';
  end if;
end
$$;

select 'PRECHECK PASS: character appearance prerequisites are ready' as result;
