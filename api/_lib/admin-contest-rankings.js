import { requireAdmin, applyAdminSecurityHeaders } from './admin-auth.js';

const ACTIONS = new Set(['prepare', 'publish']);
const CONFIRMATION = '発表承認';
const SLOTS = [1, 2, 3];

function reply(res, status, reason) {
  return res.status(status).json({ ok: false, error: reason });
}

async function checked(promise) {
  const result = await promise;
  if (result.error) throw result.error;
  return result.data;
}

export function createAdminContestRankingsHandler({
  supabase,
  env = process.env
} = {}) {
  if (!supabase) throw new Error('supabase required');

  return async function adminContestRankings(req, res) {
    applyAdminSecurityHeaders(res);
    res.setHeader('Allow', 'GET, POST');
    if (req.method !== 'GET' && req.method !== 'POST') {
      return reply(res, 405, 'METHOD_NOT_ALLOWED');
    }
    if (req.method === 'POST' && !req.headers?.origin) {
      return reply(res, 403, 'ORIGIN_REQUIRED');
    }
    const admin = await requireAdmin({ req, res, supabase, env });
    if (!admin) return;

    try {
      const contest = await checked(
        supabase
          .from('novelight_contests')
          .select('id,status,public_visible')
          .eq('contest_key', 'novelight-november-2026')
          .maybeSingle()
      );
      if (!contest) return reply(res, 503, 'CONTEST_NOT_CONFIGURED');
      const mutationsEnabled =
        env.NOVELIGHT_CONTEST_RANKING_ADMIN_RELEASE_ENABLED === 'true';
      if (req.method === 'GET') {
        const previews = await Promise.all(
          SLOTS.map((slot) =>
            checked(
              supabase.rpc('novelight_contest_rank_release_preview', {
                p_contest_id: contest.id,
                p_slot: slot
              })
            )
          )
        );
        return res.status(200).json({
          ok: true,
          contest_status: contest.status,
          public_visible: contest.public_visible,
          admin_release_enabled: mutationsEnabled,
          slots: previews,
          awards_finalized: false
        });
      }

      if (!mutationsEnabled) return reply(res, 403, 'RELEASE_GATE_DISABLED');
      const body = req.body;
      if (
        !body ||
        typeof body !== 'object' ||
        Array.isArray(body) ||
        Object.keys(body).sort().join(',') !==
          'action,confirmation,expected_checksum,expected_snapshot_id,note,slot'
      ) {
        return reply(res, 400, 'INVALID_REQUEST');
      }
      const {
        action,
        slot,
        confirmation,
        expected_checksum: checksum,
        expected_snapshot_id: snapshotId,
        note
      } = body;
      if (
        !ACTIONS.has(action) ||
        !SLOTS.includes(slot) ||
        typeof note !== 'string' ||
        note.trim().length < 20 ||
        note.length > 500
      ) {
        return reply(res, 400, 'INVALID_ACTION');
      }
      if (
        action === 'publish' &&
        (confirmation !== CONFIRMATION ||
          typeof snapshotId !== 'string' ||
          !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(snapshotId) ||
          typeof checksum !== 'string' ||
          !/^[0-9a-f]{32}$/.test(checksum))
      ) {
        return reply(res, 400, 'MISSING_RELEASE_CONFIRMATION');
      }
      if (contest.status !== 'active' || contest.public_visible !== true) {
        return reply(res, 409, 'CONTEST_NOT_LIVE');
      }
      const output = await checked(
        supabase.rpc('novelight_contest_admin_rank_action', {
          p_contest_id: contest.id,
          p_slot: slot,
          p_actor_user_id: admin.id,
          p_action: action,
          p_expected_snapshot_id: action === 'publish' ? snapshotId : null,
          p_expected_checksum: action === 'publish' ? checksum : null,
          p_note: note.trim()
        })
      );
      if (output?.ok !== true) {
        return reply(res, 409, output?.reason || 'RANK_RELEASE_CONFLICT');
      }
      return res.status(200).json({
        ok: true,
        result: output,
        awards_finalized: false
      });
    } catch (error) {
      console.error('[admin-contest-rankings] request failed', error);
      return reply(res, 500, 'RANKING_ADMIN_FAILED');
    }
  };
}
