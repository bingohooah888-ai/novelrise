import { URL } from 'node:url';

const PAGE_SIZE = 1000;
const MAX_PAGED_ROWS = 50000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_WINDOWS = new Set([7, 30, 90]);

class AdminConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AdminConfigurationError';
  }
}

function getBearerToken(authorization) {
  const match =
    typeof authorization === 'string'
      ? authorization.match(/^Bearer\s+(\S+)$/i)
      : null;

  return match?.[1] ?? null;
}

function csvValues(value) {
  return String(value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function parseAdminAllowlist(env = process.env) {
  const userIds = csvValues(env.NOVELIGHT_ADMIN_USER_IDS);
  const emails = csvValues(env.NOVELIGHT_ADMIN_EMAILS).map((email) =>
    email.toLowerCase()
  );

  if (userIds.some((id) => !UUID_PATTERN.test(id))) {
    throw new AdminConfigurationError('Admin user ID allowlist is malformed');
  }

  if (emails.some((email) => !EMAIL_PATTERN.test(email))) {
    throw new AdminConfigurationError('Admin email allowlist is malformed');
  }

  if (!userIds.length && !emails.length) {
    throw new AdminConfigurationError('Admin allowlist is not configured');
  }

  return {
    userIds: new Set(userIds.map((id) => id.toLowerCase())),
    emails: new Set(emails)
  };
}

function isAllowedAdmin(user, allowlist) {
  const id = typeof user?.id === 'string' ? user.id.toLowerCase() : '';
  const email =
    typeof user?.email === 'string' ? user.email.trim().toLowerCase() : '';

  return allowlist.userIds.has(id) || (email && allowlist.emails.has(email));
}

function firstHeaderValue(value) {
  if (Array.isArray(value)) return value[0] ?? '';
  return String(value ?? '')
    .split(',')[0]
    .trim();
}

export function isSameOriginRequest(req) {
  const fetchSite = firstHeaderValue(req.headers?.['sec-fetch-site']);
  if (fetchSite === 'cross-site') return false;

  const origin = firstHeaderValue(req.headers?.origin);
  if (!origin) return true;

  const host = firstHeaderValue(
    req.headers?.['x-forwarded-host'] ?? req.headers?.host
  );
  if (!host) return false;

  const protocol =
    firstHeaderValue(req.headers?.['x-forwarded-proto']) || 'https';

  try {
    return new URL(origin).origin === `${protocol}://${host}`;
  } catch {
    return false;
  }
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

async function exactCount(supabase, table, configure = (query) => query) {
  let query = supabase.from(table).select('*', {
    count: 'exact',
    head: true
  });
  query = configure(query);
  const { count, error } = await query;

  if (error) {
    throw new Error(`Admin count failed for ${table}: ${error.message}`);
  }

  return Number(count ?? 0);
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
    query = configure(query);
    query = query.range(from, from + PAGE_SIZE - 1);

    const { data, error } = await query;
    if (error) {
      throw new Error(`Admin query failed for ${table}: ${error.message}`);
    }

    const page = data ?? [];
    rows.push(...page);

    if (page.length < PAGE_SIZE) return rows;
  }

  throw new Error(`Admin query row cap reached for ${table}`);
}

async function fetchTopWorks(supabase) {
  const { data, error } = await supabase
    .from('novels')
    .select('id,title,user_id,pv,favorites,created_at')
    .eq('status', 'published')
    .order('pv', { ascending: false })
    .limit(10);

  if (error) {
    throw new Error(`Admin top works query failed: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    id: String(row.id),
    title: row.title ?? 'タイトル未設定',
    authorId: row.user_id,
    pv: Number(row.pv ?? 0),
    favorites: Number(row.favorites ?? 0),
    createdAt: row.created_at
  }));
}

function unique(values) {
  return new Set(values.filter(Boolean));
}

function rate(numerator, denominator) {
  if (!denominator) return null;
  return Number(((numerator / denominator) * 100).toFixed(2));
}

export function calculateRetention({ userIds, lifecycleRows, days, now }) {
  const nowDate = now instanceof Date ? now : new Date(now);
  const cutoff = daysAgo(nowDate, days);
  const ids = userIds instanceof Set ? userIds : new Set(userIds ?? []);
  let eligible = 0;
  let retained = 0;

  for (const row of lifecycleRows ?? []) {
    if (!ids.has(row.user_id)) continue;

    const registeredAt = new Date(row.registered_at);
    const lastSeenAt = new Date(row.last_seen_at);
    if (!Number.isFinite(registeredAt.getTime())) continue;
    if (registeredAt > cutoff) continue;

    eligible += 1;
    const retentionThreshold = new Date(
      registeredAt.getTime() + days * 24 * 60 * 60 * 1000
    );
    if (
      Number.isFinite(lastSeenAt.getTime()) &&
      lastSeenAt >= retentionThreshold
    ) {
      retained += 1;
    }
  }

  return {
    eligible,
    retained,
    rate: rate(retained, eligible)
  };
}

function sourceBreakdown(rows) {
  const counts = new Map();
  for (const row of rows ?? []) {
    const source = String(row.source || 'direct').toLowerCase();
    counts.set(source, (counts.get(source) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count || a.source.localeCompare(b.source))
    .slice(0, 8);
}

function sum(rows, key) {
  return (rows ?? []).reduce((total, row) => total + Number(row[key] ?? 0), 0);
}

export async function loadAdminOverview({
  supabase,
  days = 30,
  now = new Date()
}) {
  const cutoff7 = daysAgo(now, 7).toISOString();
  const cutoff30 = daysAgo(now, 30).toISOString();
  const cutoffWindow = daysAgo(now, days).toISOString();
  const activityCutoff30 = cutoff30.slice(0, 10);
  const activityCutoff7 = cutoff7.slice(0, 10);

  const countPromises = {
    totalUsers: exactCount(supabase, 'profiles'),
    newUsers7d: exactCount(supabase, 'profiles', (query) =>
      query.gte('created_at', cutoff7)
    ),
    newUsers30d: exactCount(supabase, 'profiles', (query) =>
      query.gte('created_at', cutoff30)
    ),
    freeUsers: exactCount(supabase, 'profiles', (query) =>
      query.eq('plan', 'free')
    ),
    standardUsers: exactCount(supabase, 'profiles', (query) =>
      query.eq('plan', 'standard')
    ),
    premiumUsers: exactCount(supabase, 'profiles', (query) =>
      query.eq('plan', 'premium')
    ),
    publishedWorks: exactCount(supabase, 'novels', (query) =>
      query.eq('status', 'published')
    ),
    zeroPvWorks: exactCount(supabase, 'novels', (query) =>
      query.eq('status', 'published').eq('pv', 0)
    ),
    newReports: exactCount(supabase, 'content_reports', (query) =>
      query.eq('status', 'new')
    ),
    newInquiries: exactCount(supabase, 'contact_inquiries', (query) =>
      query.eq('status', 'new')
    ),
    detailOpens: exactCount(supabase, 'reader_journey_events', (query) =>
      query.eq('event_type', 'detail_open').gte('occurred_at', cutoffWindow)
    ),
    bodyReads: exactCount(supabase, 'reader_journey_events', (query) =>
      query
        .eq('event_type', 'episode_read_10s')
        .gte('occurred_at', cutoffWindow)
    ),
    favoritesAdded: exactCount(supabase, 'reader_journey_events', (query) =>
      query.eq('event_type', 'favorite_added').gte('occurred_at', cutoffWindow)
    ),
    lightSeeds: exactCount(supabase, 'reader_journey_events', (query) =>
      query.eq('event_type', 'light_seed').gte('occurred_at', cutoffWindow)
    )
  };

  const [
    counts,
    novels,
    episodes,
    readerRows,
    lifecycleRows,
    activityRows,
    acquisitionRows,
    topWorks
  ] = await Promise.all([
    Promise.all(
      Object.entries(countPromises).map(async ([key, promise]) => [
        key,
        await promise
      ])
    ).then((entries) => Object.fromEntries(entries)),
    fetchPaged(supabase, 'novels', 'id,user_id,status,pv,favorites,created_at'),
    fetchPaged(supabase, 'episodes', 'id,pv,created_at'),
    fetchPaged(
      supabase,
      'reader_journey_events',
      'user_id,occurred_at',
      (query) => query.not('user_id', 'is', null)
    ),
    fetchPaged(
      supabase,
      'user_lifecycle',
      'user_id,registered_at,last_seen_at'
    ),
    fetchPaged(
      supabase,
      'beta_activity_days',
      'viewer_key_hash,user_id,activity_date',
      (query) => query.gte('activity_date', activityCutoff30)
    ),
    fetchPaged(supabase, 'user_acquisition', 'source'),
    fetchTopWorks(supabase)
  ]);

  const authorIds = unique(novels.map((row) => row.user_id));
  const readerIds = unique(readerRows.map((row) => row.user_id));
  const readersInWindow = unique(
    readerRows
      .filter((row) => row.occurred_at >= cutoffWindow)
      .map((row) => row.user_id)
  );
  const active30 = unique(activityRows.map((row) => row.viewer_key_hash));
  const active7 = unique(
    activityRows
      .filter((row) => row.activity_date >= activityCutoff7)
      .map((row) => row.viewer_key_hash)
  );

  const authorRetention30d = calculateRetention({
    userIds: authorIds,
    lifecycleRows,
    days: 30,
    now
  });
  const readerRetention30d = calculateRetention({
    userIds: readerIds,
    lifecycleRows,
    days: 30,
    now
  });

  return {
    generatedAt: now.toISOString(),
    windowDays: days,
    summary: {
      totalUsers: counts.totalUsers,
      newUsers7d: counts.newUsers7d,
      newUsers30d: counts.newUsers30d,
      authors: authorIds.size,
      readersInWindow: readersInWindow.size,
      activeViewers7d: active7.size,
      activeViewers30d: active30.size,
      publishedWorks: counts.publishedWorks,
      zeroPvWorks: counts.zeroPvWorks,
      zeroPvRate: rate(counts.zeroPvWorks, counts.publishedWorks),
      workPv: sum(novels, 'pv'),
      episodePv: sum(episodes, 'pv'),
      favorites: sum(novels, 'favorites')
    },
    retention: {
      author30d: authorRetention30d,
      reader30d: readerRetention30d
    },
    plans: {
      free: counts.freeUsers,
      standard: counts.standardUsers,
      premium: counts.premiumUsers
    },
    funnel: {
      detailOpens: counts.detailOpens,
      bodyReads10s: counts.bodyReads,
      favoritesAdded: counts.favoritesAdded,
      lightSeeds: counts.lightSeeds,
      detailToReadRate: rate(counts.bodyReads, counts.detailOpens),
      detailToFavoriteRate: rate(counts.favoritesAdded, counts.detailOpens)
    },
    acquisition: sourceBreakdown(acquisitionRows),
    operations: {
      newReports: counts.newReports,
      newInquiries: counts.newInquiries
    },
    topWorks
  };
}

function sanitizedNameSearch(query) {
  return query.replace(/[%_]/g, '').trim();
}

async function fetchRowsByUserIds(supabase, table, columns, userColumn, ids) {
  if (!ids.length) return [];
  const { data, error } = await supabase
    .from(table)
    .select(columns)
    .in(userColumn, ids);

  if (error) {
    throw new Error(
      `Admin user detail query failed for ${table}: ${error.message}`
    );
  }

  return data ?? [];
}

export async function searchAdminUsers({ supabase, query }) {
  const normalized = String(query ?? '').trim();
  if (!normalized) return [];

  let profileQuery = supabase
    .from('profiles')
    .select(
      'id,display_name,plan,created_at,payment_status,subscription_status,subscription_cancel_at_period_end,subscription_current_period_end'
    )
    .limit(20);

  if (UUID_PATTERN.test(normalized)) {
    profileQuery = profileQuery.eq('id', normalized);
  } else {
    const nameQuery = sanitizedNameSearch(normalized);
    if (nameQuery.length < 2) return [];
    profileQuery = profileQuery.ilike('display_name', `%${nameQuery}%`);
  }

  const { data: profiles, error } = await profileQuery;
  if (error) {
    throw new Error(`Admin profile search failed: ${error.message}`);
  }

  const matches = profiles ?? [];
  const ids = matches.map((profile) => profile.id);
  if (!ids.length) return [];

  const [novels, lifecycle, acquisition, founding] = await Promise.all([
    fetchRowsByUserIds(
      supabase,
      'novels',
      'user_id,status,pv,favorites',
      'user_id',
      ids
    ),
    fetchRowsByUserIds(
      supabase,
      'user_lifecycle',
      'user_id,last_seen_at',
      'user_id',
      ids
    ),
    fetchRowsByUserIds(
      supabase,
      'user_acquisition',
      'user_id,source,campaign,first_touched_at',
      'user_id',
      ids
    ),
    fetchRowsByUserIds(
      supabase,
      'founding_authors',
      'author_id,founding_number,qualified_at',
      'author_id',
      ids
    )
  ]);

  const lifecycleByUser = new Map(lifecycle.map((row) => [row.user_id, row]));
  const acquisitionByUser = new Map(
    acquisition.map((row) => [row.user_id, row])
  );
  const foundingByUser = new Map(founding.map((row) => [row.author_id, row]));

  return matches.map((profile) => {
    const works = novels.filter((row) => row.user_id === profile.id);
    const publishedWorks = works.filter((row) => row.status === 'published');
    const firstTouch = acquisitionByUser.get(profile.id);
    const foundingRow = foundingByUser.get(profile.id);

    return {
      id: profile.id,
      displayName: profile.display_name ?? '名前未設定',
      plan: profile.plan ?? 'free',
      registeredAt: profile.created_at,
      lastSeenAt: lifecycleByUser.get(profile.id)?.last_seen_at ?? null,
      paymentStatus: profile.payment_status ?? null,
      subscriptionStatus: profile.subscription_status ?? null,
      cancelAtPeriodEnd: Boolean(profile.subscription_cancel_at_period_end),
      subscriptionCurrentPeriodEnd:
        profile.subscription_current_period_end ?? null,
      workCount: works.length,
      publishedWorkCount: publishedWorks.length,
      totalWorkPv: sum(works, 'pv'),
      totalFavorites: sum(works, 'favorites'),
      acquisitionSource: firstTouch?.source ?? null,
      acquisitionCampaign: firstTouch?.campaign ?? null,
      firstTouchedAt: firstTouch?.first_touched_at ?? null,
      foundingNumber: foundingRow?.founding_number ?? null,
      foundingQualifiedAt: foundingRow?.qualified_at ?? null
    };
  });
}

function applySecurityHeaders(res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Vary', 'Authorization');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
}

export function createAdminDashboardHandler({
  supabase,
  env = process.env,
  loadOverview = loadAdminOverview,
  searchUsers = searchAdminUsers,
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
    } catch (error) {
      if (error instanceof AdminConfigurationError) {
        console.error('NOVELIGHT admin allowlist configuration is invalid');
        return res
          .status(503)
          .json({ error: 'Admin access is not configured' });
      }
      throw error;
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

      const searchQuery = normalizeSearchQuery(req.query?.q);
      if (searchQuery === null) {
        return res.status(400).json({ error: 'Invalid search query' });
      }

      const now = clock();
      const [overview, users] = await Promise.all([
        loadOverview({ supabase, days, now }),
        searchQuery ? searchUsers({ supabase, query: searchQuery }) : []
      ]);

      return res.status(200).json({
        ...overview,
        users
      });
    } catch (error) {
      console.error('NOVELIGHT admin dashboard request failed', {
        message: error?.message ?? 'unknown error'
      });
      return res.status(500).json({ error: 'Admin dashboard unavailable' });
    }
  };
}
