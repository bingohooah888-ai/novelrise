-- NOVELIGHT public official thumbnail lookup.
-- Keeps public work-card thumbnail hydration behind a narrow aggregate RPC.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260913141000'));

create or replace function public.novelight_public_thumbnail_urls(
  p_novel_ids text[]
)
returns table (
  novel_id text,
  thumbnail_url text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_novel_ids is null or cardinality(p_novel_ids) = 0 then
    return;
  end if;

  if cardinality(p_novel_ids) > 100 then
    raise exception using
      errcode = '22023',
      message = 'Too many novel ids';
  end if;

  return query
  select
    n.id::text,
    case
      when n.thumbnail_url like 'https://%' then n.thumbnail_url
      else null
    end
  from public.novels n
  where n.status = 'published'
    and n.id::text = any(p_novel_ids);
end;
$$;

revoke all on function public.novelight_public_thumbnail_urls(text[]) from public;
grant execute on function public.novelight_public_thumbnail_urls(text[]) to anon, authenticated;

commit;
