import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from './_lib/admin-auth.js';
import {
  buildAdminAlerts,
  buildMetricComparisons,
  normalizeAdminRange
} from './_lib/admin-metrics.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const METRIC_KEYS = [
  'unique_visitors',
  'pageviews',
  'logged_in_users',
  'new_users',
  'new_authors',
  'new_readers',
  'novels_created',
  'episodes_published',
  'reading_users'
];

function jstDateString(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function addDays(dateText, amount) {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function isMissingAnalyticsSchema(error) {
  if (!error) return false;
  const text = [error.message, error.details, error.hint]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    text.includes('admin_metrics_daily') ||
    text.includes('novelight_admin_refresh_metrics_daily')
  );
}

async function refreshMetricsIfNeeded(today) {
  const { data, error } = await supabase
    .from('admin_metrics_daily')
    .select('metric_date,updated_at')
    .order('metric_date', { ascending: false })
    .limit(1);
  if (error) throw error;

  const latest = data?.[0] ?? null;
  let fromDate = null;
  if (!latest) {
    fromDate = '2026-08-23';
  } else if (latest.metric_date < today) {
    fromDate = addDays(latest.metric_date, 1);
  } else {
    const updatedAt = new Date(latest.updated_at).getTime();
    const stale =
      !Number.isFinite(updatedAt) || Date.now() - updatedAt > 15 * 60 * 1000;
    if (stale) fromDate = today;
  }

  if (!fromDate) return;
  const { error: refreshError } = await supabase.rpc(
    'novelight_admin_refresh_metrics_daily',
    { p_from_date: fromDate, p_to_date: today }
  );
  if (refreshError) throw refreshError;
}

async function loadMetricRows(range, today) {
  let startDate = null;
  if (range !== 'all') startDate = addDays(today, -(Number(range) - 1));

  const pageSize = 1000;
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    let query = supabase
      .from('admin_metrics_daily')
      .select(
        'metric_date,unique_visitors,pageviews,logged_in_users,new_users,new_authors,new_readers,novels_created,episodes_published,reading_users,updated_at'
      )
      .lte('metric_date', today)
      .order('metric_date', { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (startDate) query = query.gte('metric_date', startDate);

    const { data, error } = await query;
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

async function countRows(table, configure) {
  let query = supabase.from(table).select('*', { count: 'exact', head: true });
  query = configure(query);
  const { count, error } = await query;
  if (error) throw error;
  return Number(count ?? 0);
}

async function loadCurrentSignals() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [
    pendingInquiries,
    publishedWorks,
    zeroPvWorks,
    unresolvedRenderFailures
  ] = await Promise.all([
    countRows('contact_inquiries', (query) => query.eq('status', 'new')),
    countRows('novels', (query) => query.eq('status', 'published')),
    countRows('novels', (query) => query.eq('status', 'published').eq('pv', 0)),
    countRows('thumbnail_render_failures', (query) =>
      query.gte('created_at', since).is('resolved_at', null)
    ).catch(() => 0)
  ]);

  const zeroPvRate = publishedWorks
    ? Math.round((zeroPvWorks / publishedWorks) * 1000) / 10
    : 0;
  return {
    pendingInquiries,
    publishedWorks,
    zeroPvWorks,
    zeroPvRate,
    unresolvedRenderFailures
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const admin = await requireAdmin({ req, res, supabase, env: process.env });
  if (!admin) return;

  const range = normalizeAdminRange(req.query?.range);
  const today = jstDateString();

  try {
    await refreshMetricsIfNeeded(today);
    const [rows, signals] = await Promise.all([
      loadMetricRows(range, today),
      loadCurrentSignals()
    ]);

    const todayRow = rows.find((row) => row.metric_date === today) ?? {
      metric_date: today,
      ...Object.fromEntries(METRIC_KEYS.map((key) => [key, 0]))
    };
    const comparisons = buildMetricComparisons(rows, METRIC_KEYS);
    const alerts = buildAdminAlerts({
      rows,
      pendingInquiries: signals.pendingInquiries,
      unresolvedRenderFailures: signals.unresolvedRenderFailures,
      zeroPvRate: signals.zeroPvRate,
      publishedWorks: signals.publishedWorks
    });

    return res.status(200).json({
      range,
      generatedAt: new Date().toISOString(),
      today: {
        ...todayRow,
        pending_inquiries: signals.pendingInquiries,
        anomaly_count: alerts.length
      },
      comparisons,
      daily: rows,
      alerts,
      discovery: {
        publishedWorks: signals.publishedWorks,
        zeroPvWorks: signals.zeroPvWorks,
        zeroPvRate: signals.zeroPvRate
      },
      measurementStarts: {
        traffic: '2026-08-23',
        readerJourney: '2026-08-23',
        episodePageviews: '2026-09-01',
        validRead: '2026-09-12',
        exposure: '2026-08-28',
        episodeFirstPublishedAt: 'migration-activation'
      },
      caveats: [
        'PVは時系列で正確に取得できるエピソード閲覧PVです。サイト全体PVとしては扱いません。',
        '話数の初回公開日時は本改修のDB migration適用後から記録します。過去の公開日時は推測しません。',
        '異常検知は通知のみで、自動BAN・自動制限は行いません。'
      ]
    });
  } catch (error) {
    if (isMissingAnalyticsSchema(error)) {
      return res.status(503).json({
        error: 'Admin analytics schema is not ready',
        code: 'ADMIN_ANALYTICS_NOT_READY'
      });
    }
    console.error('NOVELIGHT admin dashboard v2 failed', {
      message: error?.message ?? 'unknown error'
    });
    return res.status(500).json({ error: 'ADMIN dashboard unavailable' });
  }
}
