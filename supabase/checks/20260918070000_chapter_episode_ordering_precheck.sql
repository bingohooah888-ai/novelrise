\set ON_ERROR_STOP on

do $$
begin
  if to_regclass('public.novels') is null or to_regclass('public.episodes') is null then
    raise exception 'Required novels/episodes tables are missing';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.novels'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.episodes'::regclass) then
    raise exception 'RLS must be enabled on novels and episodes';
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.episodes'::regclass
       and contype = 'u'
       and pg_get_constraintdef(oid) ilike '%unique (novel_id, episode_number)%'
  ) then
    raise exception 'Expected UNIQUE(novel_id, episode_number) constraint is missing';
  end if;

  if exists (
    select 1
      from public.episodes
     where episode_number is null or episode_number < 1
  ) then
    raise exception 'All existing episode numbers must be positive';
  end if;

  if exists (
    select 1
      from public.episodes
     group by novel_id, episode_number
    having count(*) > 1
  ) then
    raise exception 'Duplicate episode numbers exist';
  end if;

  if to_regclass('public.novel_chapters') is not null then
    raise exception 'public.novel_chapters already exists';
  end if;

  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'episodes'
       and column_name = 'chapter_id'
  ) then
    raise exception 'episodes.chapter_id already exists';
  end if;

  if to_regprocedure('public.novelight_create_novel_chapter(bigint,text)') is not null
     or to_regprocedure('public.novelight_rename_novel_chapter(bigint,text)') is not null
     or to_regprocedure('public.novelight_delete_novel_chapter(bigint)') is not null
     or to_regprocedure('public.novelight_reorder_novel_structure(bigint,jsonb,jsonb)') is not null
     or to_regprocedure('public.novelight_novel_outline(bigint)') is not null then
    raise exception 'Chapter/ordering RPC already exists';
  end if;
end
$$;
