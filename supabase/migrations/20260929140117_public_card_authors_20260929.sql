create or replace function public.novelight_public_card_authors(p_novel_ids text[])
returns table(novel_id text, author_id uuid, author_name text)
language sql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
  select n.id::text as novel_id,
         n.user_id as author_id,
         p.display_name as author_name
  from public.novels n
  join public.profiles p on p.id = n.user_id
  where n.status = 'published'
    and n.id::text = any(coalesce(p_novel_ids[1:100], array[]::text[]));
$$;

revoke all on function public.novelight_public_card_authors(text[]) from public;
grant execute on function public.novelight_public_card_authors(text[]) to anon, authenticated;
