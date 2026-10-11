-- Migration presence and anon-safe EXECUTE contract.
do $$
begin
  if to_regprocedure('public.novelight_reader_episode_chapter_index(text[])') is null then
    raise exception 'Reader chapter index function missing';
  end if;
  if not has_function_privilege('anon','public.novelight_reader_episode_chapter_index(text[])','EXECUTE')
    or not has_function_privilege('authenticated','public.novelight_reader_episode_chapter_index(text[])','EXECUTE') then
    raise exception 'Reader chapter index grants missing';
  end if;
end $$;
