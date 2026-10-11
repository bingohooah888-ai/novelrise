-- No schema or data writes. Check prerequisites and collision before migration.
do $$
begin
  if to_regprocedure('public.novelight_reader_episode_index(text[])') is null
    or to_regclass('public.episodes') is null
    or to_regclass('public.novel_chapters') is null then
    raise exception 'Feedback #49 reader chapter index prerequisites missing';
  end if;
  if to_regprocedure('public.novelight_reader_episode_chapter_index(text[])') is not null then
    raise exception 'Reader chapter index already exists; inspect before migration';
  end if;
end $$;
