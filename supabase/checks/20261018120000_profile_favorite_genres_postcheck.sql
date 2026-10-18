-- Read-only postcheck: owner-only writes, opt-in public read and RLS.
do $post$
begin
  if to_regclass('public.profile_favorite_genres') is null
     or not exists (
       select 1 from pg_class
       where oid='public.profile_favorite_genres'::regclass and relrowsecurity
     ) then
    raise exception 'Favorite genres table or RLS missing';
  end if;
  if has_table_privilege('authenticated','public.profile_favorite_genres','INSERT')
     or has_table_privilege('anon','public.profile_favorite_genres','SELECT') then
    raise exception 'Direct favorite-genre access unexpectedly granted';
  end if;
  if not has_function_privilege('authenticated','public.novelight_set_my_favorite_genres(text[],boolean)','EXECUTE')
     or has_function_privilege('anon','public.novelight_set_my_favorite_genres(text[],boolean)','EXECUTE')
     or not has_function_privilege('anon','public.novelight_public_favorite_genres(uuid)','EXECUTE') then
    raise exception 'Favorite genre RPC execution permissions are incorrect';
  end if;
end;
$post$;
