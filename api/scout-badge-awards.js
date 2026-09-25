import { URL } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const MAX_AWARDS = 160;

function bearerToken(value) {
  const match =
    typeof value === 'string' ? value.match(/^Bearer\s+(\S+)$/i) : null;
  return match?.[1] ?? null;
}

function parseSince(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function requestQuery(req) {
  const raw = String(req.url ?? '');
  const base = 'https://novelight.local';
  try {
    return new URL(raw, base).searchParams;
  } catch {
    return new URL(base).searchParams;
  }
}

export function createScoutBadgeAwardsHandler({
  authenticateToken,
  listAwards,
  now = () => new Date()
}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Vary', 'Authorization');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    }

    const token = bearerToken(req.headers?.authorization);
    if (!token) {
      return res.status(401).json({ error: 'UNAUTHORIZED' });
    }

    const since = parseSince(requestQuery(req).get('since'));
    if (!since) {
      return res.status(400).json({ error: 'INVALID_SINCE' });
    }

    try {
      const user = await authenticateToken(token);
      if (!user?.id) {
        return res.status(401).json({ error: 'UNAUTHORIZED' });
      }

      const cursor = now().toISOString();
      const rows = await listAwards({
        userId: user.id,
        since,
        through: cursor,
        limit: MAX_AWARDS
      });

      return res.status(200).json({
        cursor,
        awards: (rows || []).map((row) => ({
          badge_id: row.badge_id,
          earned_at: row.earned_at,
          display_name:
            row.scout_badge_definitions?.display_name || 'SCOUT称号',
          description:
            row.scout_badge_definitions?.description || '称号条件を達成',
          metadata:
            row.metadata && typeof row.metadata === 'object' ? row.metadata : {}
        }))
      });
    } catch (error) {
      console.error('NOVELIGHT scout title award lookup failed', {
        code: error?.code || null,
        message: error?.message || null
      });
      return res.status(503).json({ error: 'SCOUT_AWARDS_UNAVAILABLE' });
    }
  };
}

let productionHandler;

export default function handler(req, res) {
  if (!productionHandler) {
    const options = {
      auth: { autoRefreshToken: false, persistSession: false }
    };
    const serviceClient = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SECRET_KEY,
      options
    );

    productionHandler = createScoutBadgeAwardsHandler({
      async authenticateToken(token) {
        const { data, error } = await serviceClient.auth.getUser(token);
        if (error || !data?.user) return null;
        return data.user;
      },
      async listAwards({ userId, since, through, limit }) {
        const { data, error } = await serviceClient
          .from('user_scout_badges')
          .select(
            'badge_id,earned_at,metadata,scout_badge_definitions!inner(display_name,description)'
          )
          .eq('user_id', userId)
          .not('earned_at', 'is', null)
          .gt('earned_at', since)
          .lte('earned_at', through)
          .order('earned_at', { ascending: true })
          .limit(limit);

        if (error) throw error;
        return data || [];
      }
    });
  }

  return productionHandler(req, res);
}
