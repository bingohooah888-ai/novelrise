import { isSameOriginRequest, parseAdminAllowlist } from './admin-dashboard.js';

const PAGE_SIZE = 1000;
const MAX_PAGED_ROWS = 50000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_WINDOWS = new Set([30, 90]);
const SOURCE_ORDER = [
  'light_seed_use',
  'star_rating',
  'comment',
  'discovery_success',
  'discovery_major',
  'discovery_great',
  'discovery_nova',
  'nova_prediction'
];
const SOURCE_LABELS = {
  light_seed_use: 'LIGHT SEED使用',
  star_rating: '☆評価',
  comment: 'コメント',
  discovery_success: '発掘成功',
  discovery_major: '大発掘',
  discovery_great: '特大発掘',
  discovery_nova: 'NOVA発掘',
  nova_prediction: 'NOVA予見'
};

function getBearerToken(authorization) {
  const match =
    typeof authorization === 'string'
      ? authorization.match(/^Bearer\s+(\S+)$/i)
      : null;

  return match?.[1] ?? null;
}

function isAllowedAdmin(user, allowlist) {
  const id = typeof user?.id === 'string' ? user.id.toLowerCase() : '';
  const email =
    typeof user?.email === 'string' ? user.email.trim().toLowerCase() : '';

  return allowlist.userIds.has(id) || (email && allowlist.emails.has(email));
}

function normalizeWindow(value) {
  if (value === undefined || value === null || value === '') return 30;
  const parsed = Number(value);
  return ALLOWED_WINDOWS.has(parsed) ? parsed : null;
}

function normalizeSearchQuery(value) {
  if (value === undefined || value === null || value === '') return '';
  const query = String(value).trim();
  if (query.length < 2 || query.length > 80) return null;
  return query;
}

function daysAgo(now, days) {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

function rate(numerator, denominator) {
  if (!denominator) return null;
  return Number(((numerator / denominator) * 100).toFixed(2));
}

function numeric(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function round2(value) {
  return Number(numeric(value).toFixed(2));
}

function jstMonthStart(now) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit'
  }).formatToParts(now);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  return `${year}-${month}-01`;
}

async function fetchPaged(
  supabase,
  table,
  columns,
  configure = (query) => query
) {
  const rows = [];

  for (let from = 0; from < MAX_PAGED_ROWS; from += PAGE_SIZE) {
    let query = supabase.from(table).select(columns);
    query = configure(query).range(from, from + PAGE_SIZE - 1);

    const { data, error } = await query;
    if (error) {
      throw new Error(
        `SCOUT admin query failed for ${table}: ${error.message}`
      );
    }

    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }

  throw new Error(`SCOUT admin query row cap reached for ${table}`);
}

export function percentile(values, fraction) {
  const sorted = (values ?? []).map(numeric).sort((a, b) => a - b);
  if (!sorted.length) return 0;

  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return round2(sorted[lower]);

  const weight = position - lower;
  return round2(sorted[lower] + (sorted[upper] - sorted[lower]) * weight);
}

export function buildHistogram(values, bucketCount = 10) {
  const normalized = (values ?? []).map(numeric);
  if (!normalized.length) return [];

  const max = Math.max(...normalized);
  if (max <= 0) {
    return [{ min: 0, max: 0, count: normalized.length }];
  }

  const width = Math.max(1, Math.ceil((max + 1) / bucketCount));
  const buckets = [];
  for (let min = 0; min <= max; min += width) {
    const upper = Math.min(max, min + width - 1);
    buckets.push({ min, max: upper, count: 0 });
  }

  for (const value of normalized) {
    const index = Math.min(Math.floor(value / width), buckets.length - 1);
    buckets[index].count += 1;
  }

  return buckets;
}

function summarizeValues(values) {
  const normalized = (values ?? []).map(numeric);
  const total = normalized.reduce((sum, value) => sum + value, 0);
  const activeUsers = normalized.filter((value) => value > 0).length;

  return {
    users: normalized.length,
    activeUsers,
    totalXp: total,
    average: normalized.length ? round2(total / normalized.length) : 0,
    p10: percentile(normalized, 0.1),
    p25: percentile(normalized, 0.25),
    p50: percentile(normalized, 0.5),
    p75: percentile(normalized, 0.75),
    p90: percentile(normalized, 0.9),
    p95: percentile(normalized, 0.95),
    p99: percentile(normalized, 0.99),
    histogram: buildHistogram(normalized)
  };
}

function xpByUser(profileIds, xpRows, cutoff = null) {
  const totals = new Map(profileIds.map((id) => [id, 0]));
  const cutoffTime = cutoff ? cutoff.getTime() : null;

  for (const row of xpRows) {
    if (!totals.has(row.user_id)) continue;
    if (cutoffTime !== null) {
      const occurredAt = new Date(row.occurred_at).getTime();
      if (!Number.isFinite(occurredAt) || occurredAt < cutoffTime) continue;
    }
    totals.set(row.user_id, totals.get(row.user_id) + numeric(row.xp_value));
  }

  return totals;
}

function discoverySourceKey(metadata) {
  const baseXp = numeric(metadata?.base_xp);
  if (baseXp === 80) return 'nova_prediction';
  if (baseXp === 1000) return 'discovery_nova';
  if (baseXp === 600) return 'discovery_great';
  if (baseXp === 300) return 'discovery_major';
  return 'discovery_success';
}

function sourceComposition(xpRows, eventsById, cutoff) {
  const result = new Map(
    SOURCE_ORDER.map((key) => [
      key,
      { key, label: SOURCE_LABELS[key], events: 0, xp: 0 }
    ])
  );
  const cutoffTime = cutoff.getTime();

  for (const row of xpRows) {
    const occurredAt = new Date(row.occurred_at).getTime();
    if (!Number.isFinite(occurredAt) || occurredAt < cutoffTime) continue;

    let key = row.xp_kind;
    if (row.xp_kind === 'light_seed_discovery') {
      key = discoverySourceKey(eventsById.get(row.source_event_id)?.metadata);
    }
    if (!result.has(key)) continue;

    const entry = result.get(key);
    entry.events += 1;
    entry.xp += numeric(row.xp_value);
  }

  return SOURCE_ORDER.map((key) => result.get(key));
}

function summarizeSeedUsage({ profiles, seeds, month }) {
  const usedByUser = new Map(profiles.map((profile) => [profile.id, 0]));
  const typeUsed = { GOLD: 0, SILVER: 0, BRONZE: 0, LEGACY: 0 };

  for (const seed of seeds) {
    if (seed.seed_month !== month || !usedByUser.has(seed.reader_id)) continue;
    usedByUser.set(seed.reader_id, usedByUser.get(seed.reader_id) + 1);
    const key = ['GOLD', 'SILVER', 'BRONZE'].includes(seed.seed_type)
      ? seed.seed_type
      : 'LEGACY';
    typeUsed[key] += 1;
  }

  const values = [...usedByUser.values()];
  const totalUsed = values.reduce((sum, value) => sum + value, 0);
  const totalAllocated = values.length * 11;
  const distribution = Array.from({ length: 12 }, (_, used) => ({
    used,
    users: values.filter((value) => value === used).length
  }));

  return {
    month,
    users: values.length,
    totalAllocated,
    totalUsed,
    useRate: rate(totalUsed, totalAllocated),
    zeroUseRate: rate(
      values.filter((value) => value === 0).length,
      values.length
    ),
    fullUseRate: rate(
      values.filter((value) => value === 11).length,
      values.length
    ),
    averageUsed: values.length ? round2(totalUsed / values.length) : 0,
    medianUsed: percentile(values, 0.5),
    typeUsed,
    distribution,
    usedByUser
  };
}

function discoveryStage(row) {
  const start = numeric(row.rank_at_seed);
  const highest = numeric(row.highest_rank_seen);
  const delta = Math.max(numeric(row.best_rank_delta), highest - start);

  return {
    plus2: delta >= 2,
    plus3: delta >= 3,
    plus4: delta >= 4,
    plus5: delta >= 5,
    novaPrediction: start === 5 && highest >= 6
  };
}

function discoveryRates(rows) {
  const byType = ['GOLD', 'SILVER', 'BRONZE'].map((seedType) => {
    const typed = rows.filter((row) => row.seed_type === seedType);
    const eligible = typed.filter((row) => numeric(row.rank_at_seed) <= 4);
    const successes = eligible.filter(
      (row) => discoveryStage(row).plus2
    ).length;
    const novaPredictions = typed.filter(
      (row) => discoveryStage(row).novaPrediction
    ).length;

    return {
      seedType,
      totalSeeds: typed.length,
      discoveryEligibleSeeds: eligible.length,
      successCount: successes,
      successRate: rate(successes, eligible.length),
      novaPredictionCount: novaPredictions
    };
  });

  const byRank = Array.from({ length: 6 }, (_, index) => index + 1).map(
    (rank) => {
      const ranked = rows.filter((row) => numeric(row.rank_at_seed) === rank);
      const stages = ranked.map(discoveryStage);
      const count = (key) => stages.filter((stage) => stage[key]).length;

      return {
        rank,
        seeds: ranked.length,
        plus2Count: count('plus2'),
        plus2Rate: rate(count('plus2'), ranked.length),
        plus3Count: count('plus3'),
        plus3Rate: rate(count('plus3'), ranked.length),
        plus4Count: count('plus4'),
        plus4Rate: rate(count('plus4'), ranked.length),
        plus5Count: count('plus5'),
        plus5Rate: rate(count('plus5'), ranked.length),
        novaPredictionCount: count('novaPrediction'),
        novaPredictionRate: rate(count('novaPrediction'), ranked.length)
      };
    }
  );

  return { byType, byRank };
}

function sourceTotalsForUser(xpRows, eventsById, userId) {
  const result = Object.fromEntries(SOURCE_ORDER.map((key) => [key, 0]));
  for (const row of xpRows) {
    if (row.user_id !== userId) continue;
    let key = row.xp_kind;
    if (row.xp_kind === 'light_seed_discovery') {
      key = discoverySourceKey(eventsById.get(row.source_event_id)?.metadata);
    }
    if (Object.hasOwn(result, key)) result[key] += numeric(row.xp_value);
  }
  return result;
}

function searchUserSummaries({
  profiles,
  query,
  xpRows,
  eventsById,
  seedUsage,
  discoveryRows,
  lifetimeByUser,
  xp30ByUser,
  xp90ByUser
}) {
  if (!query) return [];
  const normalized = query.toLowerCase();
  const matches = profiles
    .filter((profile) => {
      if (UUID_PATTERN.test(query)) return profile.id === query;
      return String(profile.display_name ?? '')
        .toLowerCase()
        .includes(normalized);
    })
    .slice(0, 20);

  return matches.map((profile) => {
    const discoveries = discoveryRows.filter(
      (row) => row.reader_id === profile.id
    );
    const successCount = discoveries.filter(
      (row) => discoveryStage(row).plus2
    ).length;
    const novaPredictionCount = discoveries.filter(
      (row) => discoveryStage(row).novaPrediction
    ).length;

    return {
      id: profile.id,
      displayName: profile.display_name ?? '名前未設定',
      registeredAt: profile.created_at,
      scoutXp: {
        lifetime: lifetimeByUser.get(profile.id) ?? 0,
        last30Days: xp30ByUser.get(profile.id) ?? 0,
        last90Days: xp90ByUser.get(profile.id) ?? 0,
        bySource: sourceTotalsForUser(xpRows, eventsById, profile.id)
      },
      lightSeed: {
        usedThisMonth: seedUsage.usedByUser.get(profile.id) ?? 0,
        monthlyAllocation: 11
      },
      discovery: {
        trackedSeeds: discoveries.length,
        successCount,
        novaPredictionCount
      }
    };
  });
}

export function summarizeScoutData({
  profiles = [],
  xpRows = [],
  eventRows = [],
  seeds = [],
  discoveryRows = [],
  days = 30,
  now = new Date(),
  query = ''
}) {
  const profileIds = profiles.map((profile) => profile.id);
  const cutoff30 = daysAgo(now, 30);
  const cutoff90 = daysAgo(now, 90);
  const cutoffWindow = daysAgo(now, days);
  const eventsById = new Map(eventRows.map((row) => [row.id, row]));
  const lifetimeByUser = xpByUser(profileIds, xpRows);
  const xp30ByUser = xpByUser(profileIds, xpRows, cutoff30);
  const xp90ByUser = xpByUser(profileIds, xpRows, cutoff90);
  const seedUsage = summarizeSeedUsage({
    profiles,
    seeds,
    month: jstMonthStart(now)
  });

  return {
    generatedAt: now.toISOString(),
    windowDays: days,
    xpDistribution: {
      lifetime: summarizeValues([...lifetimeByUser.values()]),
      last30Days: summarizeValues([...xp30ByUser.values()]),
      last90Days: summarizeValues([...xp90ByUser.values()])
    },
    sourceComposition: sourceComposition(xpRows, eventsById, cutoffWindow),
    lightSeedUsage: {
      month: seedUsage.month,
      users: seedUsage.users,
      totalAllocated: seedUsage.totalAllocated,
      totalUsed: seedUsage.totalUsed,
      useRate: seedUsage.useRate,
      zeroUseRate: seedUsage.zeroUseRate,
      fullUseRate: seedUsage.fullUseRate,
      averageUsed: seedUsage.averageUsed,
      medianUsed: seedUsage.medianUsed,
      typeUsed: seedUsage.typeUsed,
      distribution: seedUsage.distribution
    },
    discovery: discoveryRates(discoveryRows),
    users: searchUserSummaries({
      profiles,
      query,
      xpRows,
      eventsById,
      seedUsage,
      discoveryRows,
      lifetimeByUser,
      xp30ByUser,
      xp90ByUser
    })
  };
}

export async function loadScoutAnalytics({
  supabase,
  days = 30,
  now = new Date(),
  query = ''
}) {
  const [profiles, xpRows, eventRows, seeds, discoveryRows] = await Promise.all(
    [
      fetchPaged(supabase, 'profiles', 'id,display_name,created_at'),
      fetchPaged(
        supabase,
        'scout_xp_ledger',
        'user_id,source_event_id,xp_kind,xp_value,occurred_at'
      ),
      fetchPaged(
        supabase,
        'scout_event_ledger',
        'id,event_type,metadata',
        (request) => request.eq('event_type', 'light_seed_discovery')
      ),
      fetchPaged(supabase, 'light_seeds', 'reader_id,seed_type,seed_month'),
      fetchPaged(
        supabase,
        'seed_discovery_state',
        'reader_id,seed_type,rank_at_seed,highest_rank_seen,best_rank_delta,cumulative_discovery_xp,window_expires_at'
      )
    ]
  );

  return summarizeScoutData({
    profiles,
    xpRows,
    eventRows,
    seeds,
    discoveryRows,
    days,
    now,
    query
  });
}

function applySecurityHeaders(res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Vary', 'Authorization');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
}

export function createAdminScoutAnalyticsHandler({
  supabase,
  env = process.env,
  loadAnalytics = loadScoutAnalytics,
  clock = () => new Date()
}) {
  return async function handler(req, res) {
    applySecurityHeaders(res);

    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    if (!isSameOriginRequest(req)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const token = getBearerToken(req.headers?.authorization);
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    let allowlist;
    try {
      allowlist = parseAdminAllowlist(env);
    } catch {
      console.error('NOVELIGHT admin allowlist configuration is invalid');
      return res.status(503).json({ error: 'Admin access is not configured' });
    }

    try {
      const { data, error: authError } = await supabase.auth.getUser(token);
      const user = data?.user;
      if (authError || !user) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      if (!isAllowedAdmin(user, allowlist)) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const days = normalizeWindow(req.query?.days);
      if (!days) {
        return res.status(400).json({ error: 'Invalid reporting window' });
      }
      const query = normalizeSearchQuery(req.query?.q);
      if (query === null) {
        return res.status(400).json({ error: 'Invalid search query' });
      }

      const analytics = await loadAnalytics({
        supabase,
        days,
        now: clock(),
        query
      });
      return res.status(200).json(analytics);
    } catch (error) {
      console.error('NOVELIGHT SCOUT admin analytics request failed', {
        message: error?.message ?? 'unknown error'
      });
      return res.status(500).json({ error: 'SCOUT analytics unavailable' });
    }
  };
}
