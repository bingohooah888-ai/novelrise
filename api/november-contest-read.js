import { createClient } from '@supabase/supabase-js';
import { createNovemberContestReaderHandler } from './_lib/november-contest-reader.js';

let productionHandler;

export default function handler(req, res) {
  if (!productionHandler) {
    const secret = process.env.NOVELIGHT_CONTEST_GUEST_SIGNING_SECRET;
    const validSecret =
      typeof secret === 'string' &&
      Buffer.byteLength(secret, 'utf8') >= 32 &&
      secret !== process.env.SUPABASE_SECRET_KEY;
    productionHandler = createNovemberContestReaderHandler({
      enabled:
        process.env.NOVELIGHT_CONTEST_READING_ENABLED === 'true' && validSecret,
      guestSecret: secret,
      allowedOrigin:
        process.env.NOVELIGHT_CONTEST_ALLOWED_ORIGIN || 'https://novelight.jp',
      serviceClient:
        validSecret &&
        process.env.SUPABASE_URL &&
        process.env.SUPABASE_SECRET_KEY
          ? createClient(
              process.env.SUPABASE_URL,
              process.env.SUPABASE_SECRET_KEY,
              {
                auth: { autoRefreshToken: false, persistSession: false }
              }
            )
          : null
    });
  }
  return productionHandler(req, res);
}
