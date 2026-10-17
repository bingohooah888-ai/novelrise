-- Author-owned work-detail cover images; discovery thumbnails remain official.
-- Applied only after explicit Production approval.
begin;
select pg_advisory_xact_lock(hashtext('novelight:20261018060000_author_custom_covers'));

create table public.novel_custom_covers (
  novel_id bigint primary key references public.novels(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null unique,
  updated_at timestamptz not null default now(),
  constraint novel_custom_cover_path_check check (
    storage_path ~ (
      '^' || user_id::text || '/' || novel_id::text ||
      '/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$'
    )
  )
);
create index novel_custom_covers_owner_idx on public.novel_custom_covers(user_id);

alter table public.novel_custom_covers enable row level security;
revoke all on table public.novel_custom_covers from public, anon, authenticated;
grant select on table public.novel_custom_covers to anon, authenticated;
grant insert, update, delete on table public.novel_custom_covers to authenticated;
grant all on table public.novel_custom_covers to service_role;

create policy "Published works or owner can read custom covers"
on public.novel_custom_covers for select to anon, authenticated
using (
  exists (
    select 1 from public.novels n
    where n.id = novel_id
      and (n.status = 'published' or n.user_id = (select auth.uid()))
  )
);

create policy "Author can create own work cover"
on public.novel_custom_covers for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.novels n
    where n.id = novel_id and n.user_id = (select auth.uid())
  )
);
create policy "Author can update own work cover"
on public.novel_custom_covers for update to authenticated
using (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.novels n
    where n.id = novel_id and n.user_id = (select auth.uid())
  )
)
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.novels n
    where n.id = novel_id and n.user_id = (select auth.uid())
  )
);
create policy "Author can remove own work cover"
on public.novel_custom_covers for delete to authenticated
using (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.novels n
    where n.id = novel_id and n.user_id = (select auth.uid())
  )
);

do $$
declare
  v_public boolean;
  v_limit bigint;
  v_types text[];
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage unavailable; skipping cover bucket in isolated migration replay';
    return;
  end if;
  insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
  values('novel-custom-covers', 'novel-custom-covers', true, 5242880, array['image/webp'])
  on conflict(id) do nothing;
  select public, file_size_limit, allowed_mime_types
    into v_public, v_limit, v_types
    from storage.buckets where id = 'novel-custom-covers';
  if v_public is distinct from true or v_limit is distinct from 5242880
    or v_types is null or not (v_types @> array['image/webp']::text[]) then
    raise exception 'novel-custom-covers bucket configuration mismatch';
  end if;
end
$$;

do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'storage unavailable; skipping cover policies in isolated migration replay';
    return;
  end if;
  execute $policy$
    create policy "Authors select own work cover objects"
      on storage.objects for select to authenticated
      using (
        bucket_id = 'novel-custom-covers'
        and (storage.foldername(name))[1] = (select auth.uid())::text
      )
  $policy$;
  execute $policy$
    create policy "Authors upload own work cover objects"
      on storage.objects for insert to authenticated
      with check (
        bucket_id = 'novel-custom-covers'
        and name ~ (
          '^' || (select auth.uid())::text ||
          '/[0-9]+/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$'
        )
        and exists (
          select 1 from public.novels n
          where n.id::text = split_part(name, '/', 2)
            and n.user_id = (select auth.uid())
        )
      )
  $policy$;
  execute $policy$
    create policy "Authors remove own work cover objects"
      on storage.objects for delete to authenticated
      using (
        bucket_id = 'novel-custom-covers'
        and (storage.foldername(name))[1] = (select auth.uid())::text
      )
  $policy$;
end
$$;
commit;
