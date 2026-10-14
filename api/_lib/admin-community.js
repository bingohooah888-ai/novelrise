import { requireAdmin } from './admin-auth.js';

const KEY_PATTERN =
  /^(?:novel:\d+|note:\d+|curation:\d+|official:\d+|ep:[0-9a-f-]{36}:\d+:\d+)$/i;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
const POST_ACTIONS = new Set(['hide', 'restore']);
const ACTIONS = new Set(['hide', 'restore', 'restrict', 'unrestrict']);

function fail(res, status, message) {
  return res.status(status).json({ error: message });
}

async function loadCommunityState(supabase) {
  const [reports, hidden, restricted] = await Promise.all([
    supabase
      .from('community_reports')
      .select('id,post_key,reporter_user_id,reason,status,created_at')
      .in('status', ['pending', 'reviewing'])
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('community_hidden_posts')
      .select('post_key,reason,hidden_at')
      .order('hidden_at', { ascending: false })
      .limit(50),
    supabase
      .from('community_user_restrictions')
      .select('user_id,expires_at,reason,created_at')
      .order('created_at', { ascending: false })
      .limit(50)
  ]);
  for (const result of [reports, hidden, restricted]) {
    if (result.error) throw result.error;
  }
  return {
    reports: reports.data ?? [],
    hidden: hidden.data ?? [],
    restrictions: restricted.data ?? []
  };
}

function parseInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const { action, post_key: postKey, user_id: userId, reason = '' } = body;
  if (
    !ACTIONS.has(action) ||
    typeof reason !== 'string' ||
    reason.length > 500
  ) {
    return null;
  }
  const isPost = POST_ACTIONS.has(action);
  if (
    isPost &&
    (!KEY_PATTERN.test(postKey || '') || String(postKey).length > 150)
  ) {
    return null;
  }
  if (!isPost && !UUID_PATTERN.test(userId || '')) return null;
  return {
    action,
    target: isPost ? postKey : userId,
    postKey: isPost ? postKey : null,
    userId: isPost ? null : userId,
    reason: reason.trim()
  };
}

export function createAdminCommunityHandler({ supabase, env = process.env }) {
  return async function communityHandler(req, res) {
    if (!['GET', 'POST'].includes(req.method)) {
      res.setHeader('Allow', 'GET, POST');
      return fail(res, 405, 'Method not allowed');
    }
    const admin = await requireAdmin({ req, res, supabase, env });
    if (!admin) return;

    try {
      if (req.method === 'GET') {
        const [rows, metrics] = await Promise.all([
          loadCommunityState(supabase),
          supabase.rpc('novelight_admin_community_metrics', { p_days: 7 })
        ]);
        if (metrics.error) throw metrics.error;
        return res.status(200).json({ ...rows, metrics: metrics.data });
      }
      const input = parseInput(req.body);
      if (!input) return fail(res, 400, 'Invalid moderation action');
      const result = await supabase.rpc('novelight_admin_community_moderate', {
        p_admin_user_id: admin.id,
        p_action: input.action,
        p_post_key: input.postKey,
        p_user_id: input.userId,
        p_reason: input.reason
      });
      if (result.error || result.data !== true) {
        throw result.error || new Error('Moderation transaction failed');
      }
      return res.status(200).json({
        ok: true,
        action: input.action,
        target: input.target
      });
    } catch (error) {
      console.error('NOVELIGHT community admin request failed', {
        message: error?.message || 'unknown'
      });
      return fail(res, 503, 'Community moderation unavailable');
    }
  };
}
