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

export default createThumbnailRenderHandler({ supabase });
