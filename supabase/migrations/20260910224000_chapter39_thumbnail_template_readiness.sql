-- Chapter 39 template readiness guard.
-- Authors must never be offered a template until its internal cover mask exists.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260910224000'));

drop policy if exists "Public can read active thumbnail templates"
  on public.novel_thumbnail_templates;
create policy "Public can read active thumbnail templates"
  on public.novel_thumbnail_templates
  for select
  to anon, authenticated
  using (
    availability_status = 'active'
    and canvas_width = 1086
    and canvas_height = 1448
    and cover_mask_url is not null
  );

commit;
