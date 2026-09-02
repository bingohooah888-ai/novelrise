import { createClient } from '@supabase/supabase-js';
import { createPublishedAnnouncementsHandler } from './_lib/public-announcements.js';

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

export default createPublishedAnnouncementsHandler({ supabase });
