\set ON_ERROR_STOP on

begin;

select pg_advisory_xact_lock(hashtext('novelrise:20260823204500'));
select pg_advisory_xact_lock(hashtext('novelight:founding-authors'));

do $$
begin
  if exists (
    select 1
      from public.founding_author_exclusion_audit a
      join public.founding_authors f
        on f.founding_number = a.founding_number
       and f.author_id <> a.author_id
  ) then
    raise exception 'Cannot restore excluded Founding assignment because its number is now occupied';
  end if;
end
$$;

insert into public.founding_authors (
  author_id,
  founding_number,
  qualifying_novel_id,
  qualified_at
)
select
  a.author_id,
  a.founding_number,
  a.qualifying_novel_id,
  a.qualified_at
from public.founding_author_exclusion_audit a
on conflict (author_id) do nothing;

create or replace function public.assign_founding_author()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_next integer;
begin
  if new.status <> 'published' then
    return new;
  end if;

  if exists (select 1 from public.founding_authors f where f.author_id = new.user_id) then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtext('novelight:founding-authors'));

  if exists (select 1 from public.founding_authors f where f.author_id = new.user_id) then
    return new;
  end if;

  select coalesce(max(f.founding_number), 0) + 1
    into v_next
    from public.founding_authors f;

  if v_next <= 100 then
    insert into public.founding_authors (
      author_id,
      founding_number,
      qualifying_novel_id,
      qualified_at
    ) values (
      new.user_id,
      v_next,
      new.id::text,
      now()
    )
    on conflict (author_id) do nothing;
  end if;

  return new;
end
$$;

drop table public.founding_author_exclusion_audit;
drop table public.founding_author_exclusions;

commit;
