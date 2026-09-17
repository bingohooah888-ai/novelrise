\set ON_ERROR_STOP on

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260918070000-chapter-episode-ordering'));

do $$
begin
  if to_regclass('public.novel_chapters') is null then
    raise exception 'public.novel_chapters is missing; rollback scope is ambiguous';
  end if;

  if exists (
    select 1
      from public.novel_chapters
  ) or exists (
    select 1
      from public.episodes
     where chapter_id is not null
  ) then
    raise exception 'Refusing lossy rollback while chapter organization data exists';
  end if;
end
$$;

drop function if exists public.novelight_novel_outline(bigint);
drop function if exists public.novelight_reorder_novel_structure(bigint, jsonb, jsonb);
drop function if exists public.novelight_delete_novel_chapter(bigint);
drop function if exists public.novelight_rename_novel_chapter(bigint, text);
drop function if exists public.novelight_create_novel_chapter(bigint, text);

drop index if exists public.episodes_novel_chapter_number_idx;

alter table public.episodes
  drop constraint if exists episodes_chapter_same_novel_fk;

alter table public.episodes
  drop column if exists chapter_id;

drop table public.novel_chapters;

commit;
