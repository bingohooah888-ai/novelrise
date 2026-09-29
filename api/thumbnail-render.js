import { createClient } from '@supabase/supabase-js';
import { createThumbnailRenderHandler } from './_lib/thumbnail-render.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

const handler = createThumbnailRenderHandler({ supabase });
const LEGACY_RENDER_LIMIT = 8 * 1024 * 1024;
const IOS_RENDER_LIMIT = 8 * 1024 * 1024;

export default async function thumbnailRender(req, res) {
  const body = req.body && typeof req.body === 'object' ? req.body : null;
  const userAgent = String(req.headers?.['user-agent'] ?? '');

  // iOS/WebKit can emit substantially larger WebP blobs for the same canvas.
  // Keep the wider allowance limited to iPhone prepare-upload requests only.
  if (body?.action === 'prepare-upload' && /iPhone/i.test(userAgent)) {
    const fileSize = Number(body.fileSize);
    if (
      Number.isInteger(fileSize) &&
      fileSize > LEGACY_RENDER_LIMIT &&
      fileSize <= IOS_RENDER_LIMIT
    ) {
      req.body = { ...body, fileSize: LEGACY_RENDER_LIMIT };
    }
  }

  return handler(req, res);
}
