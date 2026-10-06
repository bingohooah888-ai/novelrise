import { createClient } from '@supabase/supabase-js';

import { createAdminAnnouncementImagesHandler } from './_lib/admin-announcement-images.js';

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

export default createAdminAnnouncementImagesHandler({
  supabase,
  env: process.env
});
