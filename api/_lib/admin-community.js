import { requireAdmin } from './admin-auth.js';

const KEY_PATTERN = /^(?:novel:\d+|note:\d+|official:\d+|ep:[0-9a-f-]{36}:\d+:\d+)$/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS = new Set(['hide', 'restore', 'restrict', 'unrestrict']);

function fail(res, status, message) {
  return res.status(status).json({ error: message });
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
        const [reports, hidden, restricted] = await Promise.all([
          supabase.from('community_reports')
            .select('id,post_key,reporter_user_id,reason,status,created_at')
            .in('status', ['pending', 'reviewing'])
            .order('created_at', { ascending: false }).limit(100),
          supabase.from('community_hidden_posts')
            .select('post_key,reason,hidden_at').order('hidden_at', { ascending: false }).limit(50),
          supabase.from('community_user_restrictions')
            .select('user_id,expires_at,reason,created_at')
            .order('created_at', { ascending: false }).limit(50)
        ]);
        for (const result of [reports, hidden, restricted]) {
          if (result.error) throw result.error;
        }
        return res.status(200).json({
          reports: reports.data ?? [],
          hidden: hidden.data ?? [],
          restrictions: restricted.data ?? []
        });
      }

      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        return fail(res, 400, 'Invalid request');
      }
      const { action, post_key: postKey, user_id: userId, reason = '' } = req.body;
      if (!ACTIONS.has(action) || typeof reason !== 'string' || reason.length > 500) {
        return fail(res, 400, 'Invalid moderation action');
      }
      if (['hide', 'restore'].includes(action) && (!KEY_PATTERN.test(postKey || '') || String(postKey).length > 150)) {
        return fail(res, 400, 'Invalid post');
      }
      if (['restrict', 'unrestrict'].includes(action) && !UUID_PATTERN.test(userId || '')) {
        return fail(res, 400, 'Invalid user');
      }
      const target = ['hide', 'restore'].includes(action) ? postKey : userId;
      const audit = {
        admin_user_id: admin.id,
        action: 'community.' + action,
        resource_type: ['hide','restore'].includes(action) ? 'community_post' : 'community_user',
        resource_id: target,
        metadata: { reason: reason.trim().slice(0, 500) }
      };

      let mutation;
      if (action === 'hide') {
        mutation = await supabase.from('community_hidden_posts').upsert(
          { post_key: postKey, hidden_by: admin.id, reason: reason.trim() },
          { onConflict: 'post_key' }
        );
      } else if (action === 'restore') {
        mutation = await supabase.from('community_hidden_posts').delete().eq('post_key', postKey);
      } else if (action === 'restrict') {
        mutation = await supabase.from('community_user_restrictions').upsert({
          user_id: userId, imposed_by: admin.id, reason: reason.trim(),
          expires_at: new Date(Date.now() + 7 * 86400000).toISOString()
        }, { onConflict: 'user_id' });
      } else {
        mutation = await supabase.from('community_user_restrictions').delete().eq('user_id', userId);
      }
      if (mutation.error) throw mutation.error;

      const auditResult = await supabase.from('admin_operation_audit').insert(audit);
      if (auditResult.error) {
        // The mutation occurred; fail closed and surface a monitoring signal.
        console.error('NOVELIGHT community moderation audit failed', { action });
        return fail(res, 500, 'Moderation audit failed; state may have changed');
      }
      return res.status(200).json({ ok: true, action, target });
    } catch (error) {
      console.error('NOVELIGHT community admin request failed', {
        message: error?.message || 'unknown'
      });
      return fail(res, 503, 'Community moderation unavailable');
    }
  };
}
