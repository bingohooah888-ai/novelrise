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

// CI retrigger only; removed in the next commit.
export default async function thumbnailRender(req, res) {
  return handler(req, res);
}
