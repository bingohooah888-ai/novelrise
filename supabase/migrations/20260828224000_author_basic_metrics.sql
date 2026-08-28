begin;

select pg_advisory_xact_lock(hashtext('novelight:20260828224000'));

create or replace function public.novelight_author_basic_metrics()
returns table (
  novel_count bigint,
  total_pv bigint,
  total_favorites bigint
)
language sql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
  select
    count(*)::bigint as novel_count,
    coalesce(sum(coalesce(n.pv, 0)), 0)::bigint as total_pv,
    coalesce(
      sum(
        (
          select count(*)::bigint
          from public.favorites f
          where f.novel_id::text = n.id::text
        )
      ),
      0
    )::bigint as total_favorites
  from public.novels n
  where (select auth.uid()) is not null
    and n.user_id = (select auth.uid())
$$;

revoke all on function public.novelight_author_basic_metrics() from public, anon;
grant execute on function public.novelight_author_basic_metrics() to authenticated;

create or replace function public.novelight_author_favorite_counts(p_novel_ids text[])
returns table (
  novel_id text,
  favorite_count bigint
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  if p_novel_ids is null or cardinality(p_novel_ids) = 0 then
    return;
  end if;

  if cardinality(p_novel_ids) > 100 then
    raise exception using errcode = '22023', message = 'Too many novel identifiers';
  end if;

  return query
  select
    n.id::text,
    (
      select count(*)::bigint
      from public.favorites f
      where f.novel_id::text = n.id::text
    )
  from public.novels n
  join (
    select distinct value
    from unnest(p_novel_ids) as requested(value)
  ) requested on requested.value = n.id::text
  where n.user_id = (select auth.uid());
end
$$;

revoke all on function public.novelight_author_favorite_counts(text[]) from public, anon;
grant execute on function public.novelight_author_favorite_counts(text[]) to authenticated;

commit;
