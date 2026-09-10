import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from './_lib/admin-auth.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  {
    auth: { autoRefreshToken: false, persistSession: false }
  }
);

const STATUSES = new Set([
  'preregistered',
  'verified',
  'invited',
  'registered',
  'first_novel',
  'cancelled'
]);

const LIST_COLUMNS = [
  'id',
  'pen_name',
  'email',
  'x_account',
  'work_url',
  'genre',
  'comment',
  'email_verified',
  'status',
  'invite_sent_at',
  'registered_at',
  'auth_user_id',
  'first_novel_at',
  'source',
  'admin_note',
  'created_at',
  'updated_at'
].join(',');

function sanitizeSearch(value) {
  return String(value ?? '')
    .replace(/[,()%]/g, ' ')
    .trim()
    .slice(0, 100);
}

function parsePositiveId(value) {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text)) return null;
  const id = Number(text);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function jstDayStartIso() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return new Date(
    `${values.year}-${values.month}-${values.day}T00:00:00+09:00`
  ).toISOString();
}

async function exactCount(table, configure = (query) => query) {
  let query = supabase.from(table).select('*', { count: 'exact', head: true });
  query = configure(query);
  const { count, error } = await query;
  if (error) throw error;
  return Number(count ?? 0);
}

async function loadMetrics() {
  const today = jstDayStartIso();
  const [
    total,
    todayCount,
    verified,
    invited,
    registered,
    firstNovel,
    pageViews,
    ctaClicks
  ] = await Promise.all([
    exactCount('beta_author_preregistrations', (query) =>
      query.neq('status', 'cancelled')
    ),
    exactCount('beta_author_preregistrations', (query) =>
      query.neq('status', 'cancelled').gte('created_at', today)
    ),
    exactCount('beta_author_preregistrations', (query) =>
      query.neq('status', 'cancelled').eq('email_verified', true)
    ),
    exactCount('beta_author_preregistrations', (query) =>
      query.neq('status', 'cancelled').not('invite_sent_at', 'is', null)
    ),
    exactCount('beta_author_preregistrations', (query) =>
      query.neq('status', 'cancelled').not('registered_at', 'is', null)
    ),
    exactCount('beta_author_preregistrations', (query) =>
      query.neq('status', 'cancelled').not('first_novel_at', 'is', null)
    ),
    exactCount('beta_author_preregistration_events', (query) =>
      query.eq('event_type', 'page_view')
    ),
    exactCount('beta_author_preregistration_events', (query) =>
      query.eq('event_type', 'cta_click')
    )
  ]);

  return {
    total,
    today: todayCount,
    verified,
    invited,
    registered,
    firstNovel,
    pageViews,
    ctaClicks
  };
}

async function loadSourceMetrics() {
  const sources = ['x', 'youtube', 'dm', 'direct', 'other'];
  const values = await Promise.all(
    sources.map(async (source) => [
      source,
      await exactCount('beta_author_preregistrations', (query) =>
        query.neq('status', 'cancelled').eq('source', source)
      )
    ])
  );
  return Object.fromEntries(values);
}

async function loadRows({ search, status }) {
  let query = supabase
    .from('beta_author_preregistrations')
    .select(LIST_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(1000);

  if (status && STATUSES.has(status)) query = query.eq('status', status);
  if (search) {
    query = query.or(`pen_name.ilike.%${search}%,email.ilike.%${search}%`);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

async function updateRow(id, body) {
  const patch = {};
  if (body.admin_note !== undefined) {
    const note = String(body.admin_note ?? '').trim();
    if (note.length > 1000) {
      const error = new Error('運営メモは1000文字以内で入力してください。');
      error.code = 'INVALID_INPUT';
      throw error;
    }
    patch.admin_note = note || null;
  }

  if (body.status !== undefined) {
    const status = String(body.status).trim().toLowerCase();
    if (!STATUSES.has(status)) {
      const error = new Error('Invalid status');
      error.code = 'INVALID_INPUT';
      throw error;
    }
    patch.status = status;
  }

  if (!Object.keys(patch).length) {
    const error = new Error('No supported update fields');
    error.code = 'INVALID_INPUT';
    throw error;
  }

  patch.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('beta_author_preregistrations')
    .update(patch)
    .eq('id', id)
    .select(LIST_COLUMNS)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export default async function handler(req, res) {
  if (!['GET', 'PATCH'].includes(req.method)) {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const admin = await requireAdmin({ req, res, supabase, env: process.env });
  if (!admin) return;

  try {
    if (req.method === 'GET') {
      const search = sanitizeSearch(req.query?.q);
      const status = String(req.query?.status ?? '')
        .trim()
        .toLowerCase();
      if (status && !STATUSES.has(status)) {
        return res.status(400).json({ error: 'Invalid status' });
      }

      const [rows, metrics, sources] = await Promise.all([
        loadRows({ search, status }),
        loadMetrics(),
        loadSourceMetrics()
      ]);

      return res.status(200).json({ preregistrations: rows, metrics, sources });
    }

    const id = parsePositiveId(req.body?.id);
    if (!id) return res.status(400).json({ error: 'Invalid request' });
    const preregistration = await updateRow(id, req.body ?? {});
    if (!preregistration) return res.status(404).json({ error: 'Not found' });
    return res.status(200).json({ preregistration });
  } catch (error) {
    console.error('NOVELIGHT beta author ADMIN operation failed', error);
    if (error?.code === 'INVALID_INPUT') {
      return res.status(400).json({ error: error.message });
    }
    return res.status(500).json({ error: 'Admin operation failed' });
  }
}
