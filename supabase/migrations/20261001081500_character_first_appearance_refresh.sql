-- NOVELIGHT beta feedback follow-up: keep the first-appearance boundary active
-- when an episode body is inserted or edited after the character was configured.
--
-- The previous migration updates full character rescans, but the existing per-episode
-- refresh trigger also needs the same boundary check. Manual include/exclude state is
-- intentionally untouched and remains the final authority.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20261001081500'));

create or replace function public._novelight_refresh_episode_character_appearances()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.novel_character_episode_states s
   using public.novel_characters c
   where s.episode_id = new.id
     and s.character_id = c.id
     and c.novel_id <> new.novel_id;

  update public.novel_character_episode_states s
     set auto_detected = false,
         updated_at = pg_catalog.now()
    from public.novel_characters c
   where s.episode_id = new.id
     and s.character_id = c.id
     and c.novel_id = new.novel_id
     and s.auto_detected = true;

  insert into public.novel_character_episode_states (
    character_id, episode_id, auto_detected, updated_at
  )
  select
    c.id,
    new.id,
    true,
    pg_catalog.now()
    from public.novel_characters c
    left join public.episodes first_episode
      on first_episode.id = c.first_appearance_episode_id
     and first_episode.novel_id = c.novel_id
   where c.novel_id = new.novel_id
     and c.auto_detect_enabled
     and (
       c.first_appearance_episode_id is null
       or (
         first_episode.id is not null
         and new.episode_number >= first_episode.episode_number
       )
     )
     and public._novelight_character_matches_body(c.name, c.aliases, new.content)
  on conflict (character_id, episode_id) do update
    set auto_detected = true,
        updated_at = excluded.updated_at;

  delete from public.novel_character_episode_states
   where episode_id = new.id
     and auto_detected = false
     and override_mode is null;

  return new;
end
$$;

revoke all on function public._novelight_refresh_episode_character_appearances()
  from public, anon, authenticated, service_role;

comment on function public._novelight_refresh_episode_character_appearances() is
  'Refreshes automatic character appearance for one saved episode while respecting an optional first-appearance episode; manual include/exclude overrides are preserved.';

commit;
