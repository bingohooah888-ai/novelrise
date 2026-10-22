import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from './_lib/admin-auth.js';

const EVIDENCE_BUCKET = 'special-evidence';
const EVIDENCE_TYPES = new Map([
  ['application/pdf', 'pdf'],
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp']
]);
const MAX_BYTES = 10 * 1024 * 1024;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let singleton;
function database() {
  if (!singleton) {
    singleton = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SECRET_KEY,
      {
        auth: { autoRefreshToken: false, persistSession: false }
      }
    );
  }
  return singleton;
}

export function evidencePath(projectId, mime, uid = randomUUID()) {
  if (!UUID.test(String(projectId)) || !UUID.test(String(uid))) return '';
  const extension = EVIDENCE_TYPES.get(mime);
  return extension ? `${projectId}/${uid}.${extension}` : '';
}

export function createSpecialEvidenceHandler({
  db,
  env = process.env,
  adminGuard = requireAdmin,
  makeId = randomUUID
} = {}) {
  return async function handler(req, res) {
    const supabase = db || database();
    const admin = await adminGuard({ req, res, supabase, env });
    if (!admin) return;
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    }
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({ error: 'INVALID_BODY' });
    }
    const projectId = String(body.project_id || '');
    const mime = String(body.mime_type || '').toLowerCase();
    const size = Number(body.size);
    if (
      !UUID.test(projectId) ||
      !EVIDENCE_TYPES.has(mime) ||
      !Number.isSafeInteger(size) ||
      size < 1 ||
      size > MAX_BYTES
    ) {
      return res.status(400).json({ error: 'INVALID_EVIDENCE' });
    }
    try {
      const { data: project, error: projectError } = await supabase
        .from('special_projects')
        .select('id')
        .eq('id', projectId)
        .maybeSingle();
      if (projectError) throw projectError;
      if (!project) return res.status(404).json({ error: 'NOT_FOUND' });

      const path = evidencePath(projectId, mime, makeId());
      if (!path) return res.status(503).json({ error: 'UPLOAD_UNAVAILABLE' });
      const { data, error } = await supabase.storage
        .from(EVIDENCE_BUCKET)
        .createSignedUploadUrl(path);
      if (error || !data?.token)
        throw error || new Error('SIGNED_UPLOAD_UNAVAILABLE');
      res.setHeader('Cache-Control', 'private, no-store');
      return res.status(200).json({
        bucket: EVIDENCE_BUCKET,
        path,
        token: data.token,
        // Transport token expires after 2 hours. Never log or persist it.
        expires_in_seconds: 7200
      });
    } catch (error) {
      console.error('SPECIAL evidence upload ticket failed', {
        code: error?.code || null
      });
      return res.status(503).json({ error: 'UPLOAD_UNAVAILABLE' });
    }
  };
}
export default createSpecialEvidenceHandler();
