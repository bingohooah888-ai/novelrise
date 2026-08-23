-- Keep internal pre-beta test accounts out of the limited Founding Author pool.
-- Exclusions are private operator data. Any removed assignment is archived so
-- rollback remains lossless while the public beta is still closed.

begin;

select pg_advisory_xact_lock(hashtext('novelrise:20260823204500'));

create table public.founding_author_exclusions (
  user_id uuid primary key,
  reason text not null,
  created_at timestamptz not null default now()
);

create table public.founding_author_exclusion_audit (
  author_id uuid primary key,
  founding_number integer not null,
  qualifying_novel_id text not null,
  qualified_at timestamptz not null,
  excluded_at timestamptz not null default now(),
  reason text not null
);

alter table public.founding_author_exclusions enable row level security;
alter table public.founding_author_exclusion_audit enable row level security;
revoke all on table public.founding_author_exclusions from public, anon, authenticated;
revoke all on table public.founding_author_exclusion_audit from public, anon, authenticated;

-- These exact names are pre-beta fixtures already present in the closed
-- production database. Resolve them to immutable IDs once; future users are
-- never classified by display name.
do $$
declare
  v_matches integer;
begin
  select count(*)::integer
    into v_matches
    from public.profiles p
   where btrim(coalesce(p.display_name, '')) in ('テスト作者', 'テスト君', '登録テスト');

  if v_matches > 3 then
    raise exception 'Unexpected number of pre-beta test profiles: %', v_matches;
  end if;
end
$$;

insert into public.founding_author_exclusions (user_id, reason)
select p.id, 'pre-beta internal test account'
  from public.profiles p
 where btrim(coalesce(p.display_name, '')) in ('テスト作者', 'テスト君', '登録テスト')
on conflict (user_id) do nothing;

-- Never renumber a real Founding Author automatically. If an excluded test
-- assignment sits before a real assignment, stop and require operator review.
do $$
declare
  v_excluded_min integer;
  v_real_max integer;
begin
  select min(f.founding_number)
    into v_excluded_min
    from public.founding_authors f
    join public.founding_author_exclusions e on e.user_id = f.author_id;

  select max(f.founding_number)
    into v_real_max
    from public.founding_authors f
   where not exists (
     select 1
       from public.founding_author_exclusions e
      where e.user_id = f.author_id
   );

  if v_excluded_min is not null
     and v_real_max is not null
     and v_excluded_min <= v_real_max then
    raise exception 'Internal test Founding number precedes a real assignment; manual review required';
  end if;
end
$$;

insert into public.founding_author_exclusion_audit (
  author_id,
  founding_number,
  qualifying_novel_id,
  qualified_at,
  reason
)
select
  f.author_id,
  f.founding_number,
  f.qualifying_novel_id,
  f.qualified_at,
  e.reason
from public.founding_authors f
join public.founding_author_exclusions e on e.user_id = f.author_id
on conflict (author_id) do nothing;

delete from public.founding_authors f
using public.founding_author_exclusions e
where e.user_id = f.author_id;

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

  if exists (
    select 1
      from public.founding_author_exclusions e
     where e.user_id = new.user_id
  ) then
    return new;
  end if;

  if exists (select 1 from public.founding_authors f where f.author_id = new.user_id) then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtext('novelight:founding-authors'));

  if exists (
    select 1
      from public.founding_author_exclusions e
     where e.user_id = new.user_id
  ) then
    return new;
  end if;

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

commit;
