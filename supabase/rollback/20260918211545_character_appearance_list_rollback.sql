\set ON_ERROR_STOP on

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260918211545'));

do $$
begin
  if to_regclass('public.novel_characters') is not null
     and exists (select 1 from public.novel_characters limit 1) then
    raise exception 'ROLLBACK REFUSED: registered character data exists; preserve/export it before destructive rollback';
  end if;

  if to_regclass('public.novel_character_episode_states') is not null
     and exists (select 1 from public.novel_character_episode_states limit 1) then
    raise exception 'ROLLBACK REFUSED: character appearance state exists; preserve/export it before destructive rollback';
  end if;
end
$$;

drop trigger if exists novelight_refresh_episode_character_appearances
  on public.episodes;

drop function if exists public.novelight_character_feed(bigint);
drop function if exists public.novelight_set_character_episode_override(bigint,bigint,text);
drop function if exists public.novelight_episode_character_editor(bigint);
drop function if exists public.novelight_author_character_list(bigint);
drop function if exists public.novelight_delete_character(bigint);
drop function if exists public.novelight_upsert_character(bigint,bigint,text,text[],boolean,boolean);
drop function if exists public._novelight_refresh_episode_character_appearances();
drop function if exists public._novelight_rescan_character(bigint);
drop function if exists public._novelight_character_matches_body(text,text[],text);

drop table if exists public.novel_character_episode_states;
drop table if exists public.novel_characters;

commit;
