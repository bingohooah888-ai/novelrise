import { createClient } from '@supabase/supabase-js';
import { createEpisodeIllustrationsHandler } from './_lib/episode-illustrations.js';

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

export default createEpisodeIllustrationsHandler({ supabase });
