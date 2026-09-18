-- Rollback for 20260918152523_reader_bookshelf_organization.sql

begin;

do $$
begin
  if to_regclass('public.reader_bookshelf_entries') is not null
     and exists (select 1 from public.reader_bookshelf_entries limit 1) then
    raise exception 'Rollback blocked: reader bookshelf contains private user data';
  end if;
end
$$;

drop trigger if exists reader_bookshelf_entries_touch
  on public.reader_bookshelf_entries;
drop function if exists public.novelight_touch_reader_bookshelf_entry();
drop table if exists public.reader_bookshelf_entries;

commit;
