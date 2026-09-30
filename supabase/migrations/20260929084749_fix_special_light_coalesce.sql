-- Fix invalid schema qualification of COALESCE in the trusted Special Light feed.
begin;
select pg_advisory_xact_lock(hashtext('novelight:20260929084500:fix-special-light-coalesce'));

create or replace function private.novelight_trusted_special_zone_feed_v1_impl(
  p_zone text,
  p_mode text default 'recommended',
  p_genre text default null,
  p_limit integer default 24,
  p_offset integer default 0,
  p_rotation_key text default null,
  p_visitor_token text default null
)
returns table (
  feed_position integer,
  novel_id text,
  title text,
  genre text,
  description text,
  created_at timestamptz,
  author_id uuid,
  author_name text,
  thumbnail_url text,
  favorite_count bigint,
  rating_count bigint,
  average_rating numeric,
  qualified_reader_count bigint,
  zone text,
  allocation_receipt uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_viewer_key text;
  v_batch uuid := gen_random_uuid();
  v_zone text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_zone, '')));
  v_surface text;
begin
  if v_zone not in ('ai', 'r15', 'r18') then
    raise exception using errcode = '22023', message = 'Unknown special-light zone';
  end if;

  if v_uid is not null then
    v_viewer_key := 'user:' || v_uid::text;
  elsif p_visitor_token is not null and pg_catalog.length(pg_catalog.btrim(p_visitor_token)) between 8 and 128 then
    v_viewer_key := 'visitor:' || pg_catalog.btrim(p_visitor_token);
  else
    raise exception using errcode = '22023', message = 'Anonymous special-light discovery requires a visitor token';
  end if;

  v_surface := 'special_' || v_zone;

  return query
  with allocated as materialized (
    select *
    from public.novelight_special_zone_feed_v1(
      v_zone,
      p_mode,
      p_genre,
      p_limit,
      p_offset,
      p_rotation_key
    )
  ), issued as (
    insert into public.novel_allocation_receipts (
      batch_id,
      viewer_id,
      viewer_key,
      novel_id_snapshot,
      surface,
      author_id_snapshot,
      plan_snapshot,
      rule_version,
      allocation_reason
    )
    select
      v_batch,
      v_uid,
      v_viewer_key,
      allocated.novel_id,
      v_surface,
      allocated.author_id,
      case pg_catalog.lower(coalesce(profile.plan, 'free'))
        when 'standard' then 'standard'
        when 'premium' then 'premium'
        else 'free'
      end,
      rule.rule_version,
      'balanced'
    from allocated
    left join public.profiles as profile on profile.id = allocated.author_id
    cross join public.novel_exposure_rules as rule
    where rule.id = 1
    returning receipt_id, novel_id_snapshot
  )
  select
    allocated.feed_position,
    allocated.novel_id,
    allocated.title,
    allocated.genre,
    allocated.description,
    allocated.created_at,
    allocated.author_id,
    allocated.author_name,
    allocated.thumbnail_url,
    allocated.favorite_count,
    allocated.rating_count,
    allocated.average_rating,
    allocated.qualified_reader_count,
    allocated.zone,
    issued.receipt_id
  from allocated
  left join issued on issued.novel_id_snapshot = allocated.novel_id
  order by allocated.feed_position;
end
$$;

commit;
