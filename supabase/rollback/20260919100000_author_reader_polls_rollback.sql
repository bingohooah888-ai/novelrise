\set ON_ERROR_STOP on

begin;

do $$
begin
  if (to_regclass('public.novel_polls') is not null and exists (select 1 from public.novel_polls))
     or (to_regclass('public.novel_poll_options') is not null and exists (select 1 from public.novel_poll_options))
     or (to_regclass('public.novel_poll_votes') is not null and exists (select 1 from public.novel_poll_votes)) then
    raise exception 'ROLLBACK REFUSED: B #20 poll data exists; export it and approve destructive removal explicitly';
  end if;
end
$$;

drop function if exists public.novelight_vote_novel_poll(bigint,bigint);
drop function if exists public.novelight_close_my_novel_poll(bigint);
drop function if exists public.novelight_create_my_novel_poll(bigint,text,text[]);
drop function if exists public.novelight_manage_my_novel_polls(bigint,integer);
drop function if exists public.novelight_public_novel_poll(bigint);
drop table if exists public.novel_poll_votes;
drop table if exists public.novel_poll_options;
drop table if exists public.novel_polls;

commit;
