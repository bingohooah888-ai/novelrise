import { createClient } from '@supabase/supabase-js';
import { createAdminThumbnailsHandler } from './_lib/admin-thumbnails.js';

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

export default createAdminThumbnailsHandler({
  supabase,
  env: process.env
});
