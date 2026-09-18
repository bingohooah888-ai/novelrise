\set ON_ERROR_STOP on

begin;

do $$
begin
  if to_regclass('public.author_notes') is not null
     and exists (select 1 from public.author_notes) then
    raise exception 'ROLLBACK REFUSED: author note data exists; archive/export it and approve destructive removal explicitly';
  end if;
end
$$;

drop function if exists public.novelight_archive_my_author_note(bigint);
drop function if exists public.novelight_save_my_author_note(bigint,text,text,bigint);
drop function if exists public.novelight_manage_my_author_notes(integer);
drop function if exists public.novelight_public_author_notes(uuid,integer);
drop table if exists public.author_notes;

commit;
