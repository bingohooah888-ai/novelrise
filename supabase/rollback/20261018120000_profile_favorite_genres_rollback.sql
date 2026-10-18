-- Rollback only before any favorite-genre settings have been saved.
-- Refuse to destroy user choices after the feature becomes active.
begin;
do $rollback$
begin
  if to_regclass('public.profile_favorite_genres') is not null
     and exists(select 1 from public.profile_favorite_genres) then
    raise exception 'Favorite genre choices exist: do not run destructive rollback';
  end if;
end;
$rollback$;
drop function if exists public.novelight_public_favorite_genres(uuid);
drop function if exists public.novelight_set_my_favorite_genres(text[],boolean);
drop function if exists public.novelight_my_favorite_genres();
drop table if exists public.profile_favorite_genres;
commit;
