import { createClient } from '@supabase/supabase-js';
import { createContestRankingPrepareHandler } from './_lib/november-contest-ranking-cron.js';

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

// There is NO Vercel Cron schedule in vercel.json. Default-Deny.
export default createContestRankingPrepareHandler({
  supabase,
  env: process.env
});
