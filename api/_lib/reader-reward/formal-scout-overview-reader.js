// Formal Scout Record: read-only projection from the EXISTING badge and SEED
// source tables. Not an endpoint, job, migration, award or new source of truth.
// Must be invoked only after a trusted handler verifies the user's JWT.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SEEDS = new Set(['GOLD', 'SILVER', 'BRONZE']);
const STATUS = new Set(['in_progress', 'earned', 'revoked']);
const CATEGORY = new Set(['reader', 'author', 'limited']);
const DIFFICULTY = new Set(['easy', 'normal', 'hard', 'special']);

// The catalog is read once per verified reader, including disabled definitions
// so the future 100-title collection can show "未解放" without granting anything.
const BADGES_SQL =
  'select d.badge_id,d.badge_category,d.difficulty,d.display_name,' +
  'd.target_value,d.is_hidden,d.enabled, ' +
  'coalesce(b.progress_value,0) as progress_value,' +
  "coalesce(b.status,'in_progress') as status,b.earned_at " +
  'from public.scout_badge_definitions d ' +
  'left join public.user_scout_badges b ' +
  'on b.badge_id=d.badge_id and b.user_id=$1::uuid ' +
  "where d.badge_category='reader' " +
  'order by d.sort_order limit 100';

const SEEDS_SQL =
  'select d.seed_type,d.best_rank_delta,d.rank_at_seed,' +
  'd.highest_rank_seen,d.window_expires_at,d.updated_at,' +
  "case when n.status='published' then n.title else null end as novel_title " +
  'from public.seed_discovery_state d ' +
  'left join public.novels n on n.id::text=d.novel_id_snapshot ' +
  'where d.reader_id=$1::uuid ' +
  'order by d.updated_at desc,d.seed_id desc limit 20';

function int(value, min, max) {
  const n =
    typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(n) || n < min || n > max)
    throw new Error('SCOUT_OVERVIEW_DB_VALUE_INVALID');
  return n;
}
function date(value, optional = false) {
  if (optional && (value === null || value === undefined)) return null;
  if (!value || !Number.isFinite(Date.parse(value)))
    throw new Error('SCOUT_OVERVIEW_TIMESTAMP_INVALID');
  return new Date(value).toISOString();
}
export function createFormalScoutOverviewReader({ query } = {}) {
  if (typeof query !== 'function')
    throw new TypeError('Trusted PostgreSQL query executor required');
  return Object.freeze({
    async read(userId) {
      if (typeof userId !== 'string' || !UUID.test(userId))
        throw new TypeError('Verified reader ID required');
      const [badges, discoveries] = await Promise.all([
        query(BADGES_SQL, [userId]),
        query(SEEDS_SQL, [userId])
      ]);
      if (
        !Array.isArray(badges?.rows) ||
        !Array.isArray(discoveries?.rows) ||
        badges.rows.length > 100 ||
        discoveries.rows.length > 20
      )
        throw new Error('SCOUT_OVERVIEW_SOURCE_UNAVAILABLE');
      const seen = new Set();
      const titles = badges.rows.map((row) => {
        if (
          typeof row.badge_id !== 'string' ||
          !/^reader_[a-z0-9_]+$/.test(row.badge_id) ||
          seen.has(row.badge_id) ||
          !CATEGORY.has(row.badge_category) ||
          !DIFFICULTY.has(row.difficulty) ||
          typeof row.is_hidden !== 'boolean' ||
          typeof row.enabled !== 'boolean' ||
          !STATUS.has(row.status)
        )
          throw new Error('SCOUT_OVERVIEW_BADGE_INVALID');
        seen.add(row.badge_id);
        const earned = row.status === 'earned' && row.earned_at !== null && row.earned_at !== undefined;
        const target = int(row.target_value, 1, Number.MAX_SAFE_INTEGER);
        const progress = int(row.progress_value, 0, Number.MAX_SAFE_INTEGER);
        const title = row.is_hidden && !earned ? '???' : row.display_name;
        if (typeof title !== 'string')
          throw new Error('SCOUT_OVERVIEW_BADGE_NAME_INVALID');
        return Object.freeze({
          id: row.badge_id,
          name: title.slice(0, 120),
          difficulty: row.difficulty,
          enabled: row.enabled,
          progress,
          target,
          earned,
          earnedAt: earned ? date(row.earned_at) : null
        });
      });
      const seeds = discoveries.rows.map((row) => {
        if (!SEEDS.has(row.seed_type))
          throw new Error('SCOUT_OVERVIEW_SEED_INVALID');
        const delta = int(row.best_rank_delta, 0, 5);
        const rankAtSeed = int(row.rank_at_seed, 1, 6);
        const highest = int(row.highest_rank_seen, 1, 6);
        if (highest < rankAtSeed || delta > highest - rankAtSeed)
          throw new Error('SCOUT_OVERVIEW_SEED_RANK_INVALID');
        return Object.freeze({
          type: row.seed_type,
          growth: delta,
          novaPrediction: rankAtSeed === 5 && highest === 6,
          // Do not expose rank_at_seed / highest_rank_seen: internal Rank is private.
          workTitle:
            typeof row.novel_title === 'string'
              ? row.novel_title.slice(0, 140)
              : null,
          expiresAt: date(row.window_expires_at),
          updatedAt: date(row.updated_at)
        });
      });
      return Object.freeze({
        badges: Object.freeze(titles),
        seeds: Object.freeze(seeds)
      });
    }
  });
}
