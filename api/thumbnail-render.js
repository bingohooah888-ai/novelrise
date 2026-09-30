import { createClient } from '@supabase/supabase-js';
import { cleanupFailedThumbnailFinalize } from './_lib/thumbnail-finalize-cleanup.js';
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

export async function runThumbnailRenderEndpoint({
  req,
  res,
  service = supabase,
  renderHandler = handler
}) {
  await renderHandler(req, res);
  await cleanupFailedThumbnailFinalize({
    supabase: service,
    body: req?.body,
    statusCode: res?.statusCode
  });
}

export default async function thumbnailRender(req, res) {
  return runThumbnailRenderEndpoint({ req, res });
}
