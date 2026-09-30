-- Keep the database render-pair contract aligned with the browser/API/Storage PNG fallback.
-- Safari/WebKit can return image/png when canvas.toBlob requests WebP.

alter table public.novel_thumbnail_compositions
  drop constraint if exists novel_thumbnail_compositions_render_pair_check;

alter table public.novel_thumbnail_compositions
  add constraint novel_thumbnail_compositions_render_pair_check
  check (
    (render_storage_path is null and render_url is null)
    or (
      render_storage_path ~ '^renders/[0-9]+/[0-9a-f-]{36}[.](webp|png)$'
      and render_url like 'https://%'
    )
  );
