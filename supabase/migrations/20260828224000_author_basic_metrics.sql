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

commit;
