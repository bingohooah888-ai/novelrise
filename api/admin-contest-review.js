import { createClient } from '@supabase/supabase-js';
import { createAdminContestReviewHandler } from './_lib/admin-contest-review.js';

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

export default createAdminContestReviewHandler({
  supabase,
  env: process.env
});
