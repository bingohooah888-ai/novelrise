-- Read-only precheck for optional profile favorite reading genres.
do $pre$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.novels') is null then
    raise exception 'Profile or novel baseline is missing';
  end if;
  if to_regclass('public.profile_favorite_genres') is not null
     or to_regprocedure('public.novelight_set_my_favorite_genres(text[],boolean)') is not null then
    raise exception 'Favorite genres feature is already installed';
  end if;
end;
$pre$;
