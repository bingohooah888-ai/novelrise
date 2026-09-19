begin;

select pg_advisory_xact_lock(hashtext('novelight:20260919122554:rollback'));

do $$
begin
  if to_regclass('public.novel_private_story_notes') is not null
     and exists (select 1 from public.novel_private_story_notes limit 1) then
    raise exception 'ROLLBACK REFUSED: B #23 contains private author notes; preserve author data';
  end if;
end
$$;

drop function if exists public.novelight_delete_private_story_note(bigint);
drop function if exists public.novelight_save_private_story_note(bigint,bigint,text,bigint,text,text);
drop function if exists public.novelight_private_story_notes(bigint);
drop table if exists public.novel_private_story_notes;

commit;