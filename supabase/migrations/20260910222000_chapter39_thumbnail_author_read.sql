-- Author-only reader for Chapter 39 thumbnail re-editing.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260910222000'));

create or replace function public.novelight_my_thumbnail_composition(
  p_novel_id bigint
)
returns table (
  novel_id bigint,
  template_key text,
  background_asset_id uuid,
  base_book_asset_id uuid,
  cover_asset_id uuid,
  pattern_asset_id uuid,
  symbol_asset_id uuid,
  frame_asset_id uuid,
  effect_asset_id uuid,
  revision uuid,
  render_url text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  return query
  select
    c.novel_id,
    c.template_key,
    c.background_asset_id,
    c.base_book_asset_id,
    c.cover_asset_id,
    c.pattern_asset_id,
    c.symbol_asset_id,
    c.frame_asset_id,
    c.effect_asset_id,
    c.revision,
    c.render_url
  from public.novel_thumbnail_compositions c
  join public.novels n on n.id = c.novel_id
  where c.novel_id = p_novel_id
    and n.user_id = v_uid;
end;
$$;

revoke all on function public.novelight_my_thumbnail_composition(bigint)
  from public, anon;
grant execute on function public.novelight_my_thumbnail_composition(bigint)
  to authenticated;

commit;
