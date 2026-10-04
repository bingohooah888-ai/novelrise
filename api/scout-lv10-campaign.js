import { createClient } from '@supabase/supabase-js';
import { createScoutLv10CampaignHandler } from './_lib/scout-lv10-campaign.js';

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

export default createScoutLv10CampaignHandler({ supabase });
