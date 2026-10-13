import { createClient } from '@supabase/supabase-js';
import { createAdminContestRankingsHandler } from './_lib/admin-contest-rankings.js';

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

export default createAdminContestRankingsHandler({
  supabase,
  env: process.env
});
