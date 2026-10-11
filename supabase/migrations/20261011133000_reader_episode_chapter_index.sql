-- Reader-side chapter metadata, scoped to the existing spoiler-safe episode index.
-- The base index remains authoritative for which episodes and episode titles
-- an anonymous/reader/author request is allowed to see.
begin;

create or replace function public.novelight_reader_episode_chapter_index(p_novel_ids text[])
returns table (
  novel_id text,
  episode_id text,
  episode_number bigint,
  episode_title text,
  chapter_id bigint,
  chapter_title text
)
language sql
stable
security definer
set search_path = ''
as $function$
  select
    idx.novel_id,
    idx.episode_id,
    idx.episode_number,
    idx.episode_title,
    c.id as chapter_id,
    case
      when idx.episode_title is not null then c.title
      else null
    end as chapter_title
  from public.novelight_reader_episode_index(p_novel_ids) as idx
  left join public.episodes as e
    on e.id::text = idx.episode_id
   and e.novel_id::text = idx.novel_id
   and e.status = 'published'
  left join public.novel_chapters as c
    on c.id = e.chapter_id
   and c.novel_id = e.novel_id
  order by idx.novel_id, idx.episode_number, idx.episode_id;
$function$;

revoke all on function public.novelight_reader_episode_chapter_index(text[])
  from public, anon, authenticated, service_role;

grant execute on function public.novelight_reader_episode_chapter_index(text[])
  to anon, authenticated, service_role;

comment on function public.novelight_reader_episode_chapter_index(text[]) is
  'Published reader episode index with chapter grouping. Relies on spoiler-safe episode index; chapter titles are null for unread episodes.';

commit;
