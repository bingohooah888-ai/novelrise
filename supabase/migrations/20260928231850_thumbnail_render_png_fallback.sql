-- iPhone/Safari can fall back to PNG when canvas.toBlob requests WebP.
-- Keep WebP as the normal format while allowing the browser's actual PNG MIME.
do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage.buckets is unavailable; skipping thumbnail render MIME update in compatibility replay';
    return;
  end if;

  update storage.buckets
     set allowed_mime_types = ARRAY['image/webp', 'image/png']
   where id = 'novel-thumbnail-renders';
end
$$;
