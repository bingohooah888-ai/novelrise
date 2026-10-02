import { createClient } from '@supabase/supabase-js';

const SHARE_CAMPAIGN = 'novelight_work_share';
const ALLOWED_DAYS = new Set([7, 30, 90]);

function bearerToken(authorization) {
  const match =
    typeof authorization === 'string'
      ? authorization.match(/^Bearer\s+(\S+)$/i)
      : null;
  return match?.[1] ?? null;
}

function parseDays(value) {
  const days = Number(value || 30);
  return ALLOWED_DAYS.has(days) ? days : 30;
}

export function createAuthorShareAttributionHandler({ supabase }) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    }

    const token = bearerToken(req.headers.authorization);
    if (!token) return res.status(401).json({ error: 'UNAUTHORIZED' });

    const { data: authData, error: authError } =
      await supabase.auth.getUser(token);
    const user = authData?.user;
    if (authError || !user) {
      return res.status(401).json({ error: 'UNAUTHORIZED' });
    }

    const days = parseDays(req.query?.days);
    const since = new Date(
      Date.now() - days * 24 * 60 * 60 * 1000
    ).toISOString();

    const novels = await supabase
      .from('novels')
      .select('id')
      .eq('user_id', user.id);
    if (novels.error) {
      console.error('author share attribution novel lookup failed', {
        code: novels.error.code || null,
        message: novels.error.message || null
      });
      return res.status(503).json({ error: 'ATTRIBUTION_UNAVAILABLE' });
    }

    const contentKeys = (novels.data || [])
      .map((row) => row?.id)
      .filter(Boolean)
      .map((id) => `novel:${String(id)}`);

    if (!contentKeys.length) {
      return res.status(200).json({ days, visits: 0, registrations: 0 });
    }

    const [visitsResult, registrationsResult] = await Promise.all([
      supabase
        .from('acquisition_touches')
        .select('id', { count: 'exact', head: true })
        .eq('campaign', SHARE_CAMPAIGN)
        .in('content', contentKeys)
        .gte('touched_at', since),
      supabase
        .from('user_acquisition')
        .select('user_id', { count: 'exact', head: true })
        .eq('campaign', SHARE_CAMPAIGN)
        .in('content', contentKeys)
        .gte('first_touched_at', since)
    ]);

    if (visitsResult.error || registrationsResult.error) {
      const error = visitsResult.error || registrationsResult.error;
      console.error('author share attribution aggregation failed', {
        code: error?.code || null,
        message: error?.message || null
      });
      return res.status(503).json({ error: 'ATTRIBUTION_UNAVAILABLE' });
    }

    return res.status(200).json({
      days,
      visits: Number(visitsResult.count || 0),
      registrations: Number(registrationsResult.count || 0)
    });
  };
}

let productionHandler;

export default function handler(req, res) {
  if (!productionHandler) {
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
    productionHandler = createAuthorShareAttributionHandler({ supabase });
  }
  return productionHandler(req, res);
}
