import { timingSafeEqual } from 'node:crypto';

const SLOTS = new Map([
  [7, 1],
  [15, 2],
  [22, 3]
]);

function authorized(actual, expected) {
  if (!expected || typeof actual !== 'string') return false;
  const prefix = 'Bearer ';
  if (!actual.startsWith(prefix)) return false;
  const candidate = Buffer.from(actual.slice(prefix.length));
  const secret = Buffer.from(expected);
  return (
    candidate.length === secret.length && timingSafeEqual(candidate, secret)
  );
}

export function createContestRankingPrepareHandler({
  supabase,
  env = process.env,
  now = () => new Date()
} = {}) {
  if (!supabase) throw new Error('supabase required');
  return async function cronContestRankingPrepare(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
    }
    if (
      env.NOVELIGHT_CONTEST_RANKING_AUTO_PREP_ENABLED !== 'true' ||
      !authorized(req.headers?.authorization, env.CRON_SECRET)
    ) {
      return res.status(403).json({ ok: false, error: 'CRON_DISABLED' });
    }
    const timestamp = now();
    if (!(timestamp instanceof Date) || !Number.isFinite(timestamp.getTime())) {
      return res.status(503).json({ ok: false, error: 'INVALID_CLOCK' });
    }
    const slot =
      timestamp.getUTCFullYear() === 2026 &&
      timestamp.getUTCMonth() === 11 &&
      timestamp.getUTCHours() === 3 &&
      timestamp.getUTCMinutes() < 15
        ? SLOTS.get(timestamp.getUTCDate())
        : undefined;
    if (!slot) {
      return res
        .status(409)
        .json({ ok: false, error: 'OUTSIDE_JST_NOON_WINDOW' });
    }
    try {
      const { data: contest, error: lookupError } = await supabase
        .from('novelight_contests')
        .select('id,status,public_visible')
        .eq('contest_key', 'novelight-november-2026')
        .maybeSingle();
      if (lookupError) throw lookupError;
      if (contest?.status !== 'active' || contest.public_visible !== true) {
        return res.status(409).json({ ok: false, error: 'CONTEST_NOT_ACTIVE' });
      }
      const { data, error } = await supabase.rpc(
        'novelight_contest_auto_prepare_rank_slot',
        { p_contest_id: contest.id, p_slot: slot }
      );
      if (error) throw error;
      if (data?.ok !== true) {
        return res.status(409).json({
          ok: false,
          error: data?.reason || 'PREPARE_REJECTED'
        });
      }
      return res.status(200).json({
        ok: true,
        slot,
        prepared: true,
        published: false
      });
    } catch (error) {
      console.error('[contest-rank-auto-prepare] failed', error);
      return res.status(500).json({ ok: false, error: 'PREPARE_FAILED' });
    }
  };
}
