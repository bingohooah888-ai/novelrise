-- iPhone/Safari can fall back to PNG when canvas.toBlob requests WebP.
-- Keep WebP as the normal format while allowing the browser's actual PNG MIME.
UPDATE storage.buckets
SET allowed_mime_types = ARRAY['image/webp', 'image/png']
WHERE id = 'novel-thumbnail-renders';
