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
const CAMPAIGN_STATES = new Set(['PRE_REGISTRATION', 'BETA_OPEN', 'CLOSED']);
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

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

function inputError(message) {
  const error = new Error(message);
  error.code = 'INVALID_INPUT';
  return error;
}

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

function parsePositiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const text = String(value ?? '').trim();
  if (!text) return fallback;
  if (!/^\d+$/.test(text)) return fallback;
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

function jstDayStartIso() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const values = Object.fromEntries(
    parts.map(({ type, value }) => [type, value])
  );
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

async function loadCampaign() {
  const { data, error } = await supabase
    .from('beta_author_preregistration_config')
    .select('state,release_label,updated_at')
    .eq('id', 1)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Preregistration campaign config is missing');
  return data;
}

async function loadRows({ search, status, page, pageSize }) {
  let query = supabase
    .from('beta_author_preregistrations')
    .select(LIST_COLUMNS, { count: 'exact' })
    .order('created_at', { ascending: false });

  if (status && STATUSES.has(status)) query = query.eq('status', status);
  if (search) {
    query = query.or(`pen_name.ilike.%${search}%,email.ilike.%${search}%`);
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const { data, count, error } = await query.range(from, to);
  if (error) throw error;

  const total = Number(count ?? 0);
  return {
    rows: data ?? [],
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize))
    }
  };
}

function applyMilestones(patch, status, current, now) {
  if (['verified', 'invited', 'registered', 'first_novel'].includes(status)) {
    patch.email_verified = true;
  }
  if (['invited', 'registered', 'first_novel'].includes(status)) {
    patch.invite_sent_at = current.invite_sent_at || now;
  }
  if (['registered', 'first_novel'].includes(status)) {
    patch.registered_at = current.registered_at || now;
  }
  if (status === 'first_novel') {
    patch.first_novel_at = current.first_novel_at || now;
  }
}

async function updateRow(id, body) {
  const { data: current, error: currentError } = await supabase
    .from('beta_author_preregistrations')
    .select(LIST_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (currentError) throw currentError;
  if (!current) return null;

  const patch = {};
  if (body.admin_note !== undefined) {
    const note = String(body.admin_note ?? '').trim();
    if (note.length > 1000) {
      throw inputError('運営メモは1000文字以内で入力してください。');
    }
    patch.admin_note = note || null;
  }

  if (body.status !== undefined) {
    const status = String(body.status).trim().toLowerCase();
    if (!STATUSES.has(status)) throw inputError('Invalid status');
    patch.status = status;
    applyMilestones(patch, status, current, new Date().toISOString());
  }

  if (!Object.keys(patch).length) {
    throw inputError('No supported update fields');
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

async function updateCampaign(body) {
  const patch = {};
  if (body.state !== undefined) {
    const state = String(body.state).trim().toUpperCase();
    if (!CAMPAIGN_STATES.has(state)) throw inputError('Invalid campaign state');
    patch.state = state;
  }
  if (body.release_label !== undefined) {
    const releaseLabel = String(body.release_label ?? '').trim();
    if (releaseLabel.length < 1 || releaseLabel.length > 100) {
      throw inputError('公開時期は1文字以上100文字以内で入力してください。');
    }
    patch.release_label = releaseLabel;
  }
  if (!Object.keys(patch).length) {
    throw inputError('No supported campaign fields');
  }
  patch.updated_at = new Date().toISOString();
  const { data, error } = await supabase
    .from('beta_author_preregistration_config')
    .update(patch)
    .eq('id', 1)
    .select('state,release_label,updated_at')
    .single();
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
      const page = parsePositiveInteger(req.query?.page, 1);
      const pageSize = parsePositiveInteger(
        req.query?.pageSize,
        DEFAULT_PAGE_SIZE,
        MAX_PAGE_SIZE
      );

      const [listing, metrics, sources, campaign] = await Promise.all([
        loadRows({ search, status, page, pageSize }),
        loadMetrics(),
        loadSourceMetrics(),
        loadCampaign()
      ]);

      return res.status(200).json({
        preregistrations: listing.rows,
        pagination: listing.pagination,
        metrics,
        sources,
        campaign
      });
    }

    if (req.body?.campaign === true) {
      const campaign = await updateCampaign(req.body ?? {});
      return res.status(200).json({ campaign });
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
