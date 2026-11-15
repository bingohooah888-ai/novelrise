// Formal author-side Rank visibility, read-only and never a public Rank API.
// Only the trusted Auth-backed host may supply the verified author ID.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RANK_NAMES = Object.freeze([
  '',
  'EMBER',
  'SPARK',
  'GLOW',
  'BEACON',
  'STAR',
  'NOVA'
]);
const EVENT_TYPES = new Set(['initial', 'promotion', 'demotion', 'finalized']);
const WORKS_SQL =
  'select r.novel_id_snapshot,n.title,r.current_rank,r.peak_rank,' +
  'r.last_rank_changed_at,r.is_completed ' +
  'from public.novel_rank_state r ' +
  'join public.novels n on n.id::text=r.novel_id_snapshot ' +
  'and n.user_id=r.author_id_snapshot ' +
  'where r.author_id_snapshot=$1::uuid ' +
  'order by r.last_rank_changed_at desc,r.novel_id_snapshot limit 30';
const EVENTS_SQL =
  'select e.novel_id_snapshot,e.from_rank,e.to_rank,' +
  'e.event_type,e.occurred_at ' +
  'from public.novel_rank_events e ' +
  'join public.novels n on n.id::text=e.novel_id_snapshot ' +
  'and n.user_id=e.author_id_snapshot ' +
  'where e.author_id_snapshot=$1::uuid ' +
  'order by e.occurred_at desc,e.id desc limit 80';
function rank(value) {
  const n =
    typeof value === 'string' && /^[1-6]$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(n) || n < 1 || n > 6)
    throw new Error('FORMAL_AUTHOR_RANK_INVALID');
  return n;
}
function timestamp(value) {
  if (!value || !Number.isFinite(Date.parse(value)))
    throw new Error('FORMAL_AUTHOR_RANK_TIMESTAMP_INVALID');
  return new Date(value).toISOString();
}
function workId(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 100)
    throw new Error('FORMAL_AUTHOR_WORK_ID_INVALID');
  return value;
}
export function createFormalAuthorGrowthReader({ query } = {}) {
  if (typeof query !== 'function')
    throw new TypeError('Private PostgreSQL query executor required');
  return Object.freeze({
    async read(authorId) {
      if (typeof authorId !== 'string' || !UUID.test(authorId))
        throw new TypeError('Verified author ID required');
      const [worksData, eventsData] = await Promise.all([
        query(WORKS_SQL, [authorId]),
        query(EVENTS_SQL, [authorId])
      ]);
      if (
        !Array.isArray(worksData?.rows) ||
        !Array.isArray(eventsData?.rows) ||
        worksData.rows.length > 30 ||
        eventsData.rows.length > 80
      )
        throw new Error('FORMAL_AUTHOR_RANK_SOURCE_UNAVAILABLE');
      const works = worksData.rows.map((row) => {
        const currentRank = rank(row.current_rank);
        const peakRank = rank(row.peak_rank);
        if (
          peakRank < currentRank ||
          typeof row.title !== 'string' ||
          typeof row.is_completed !== 'boolean'
        )
          throw new Error('FORMAL_AUTHOR_WORK_INVALID');
        return Object.freeze({
          id: workId(row.novel_id_snapshot),
          title: row.title.slice(0, 140),
          rank: currentRank,
          rankName: RANK_NAMES[currentRank],
          peakRank,
          completed: row.is_completed,
          lastChangedAt: timestamp(row.last_rank_changed_at)
        });
      });
      const events = eventsData.rows.map((row) => {
        if (!EVENT_TYPES.has(row.event_type))
          throw new Error('FORMAL_AUTHOR_RANK_EVENT_INVALID');
        return Object.freeze({
          workId: workId(row.novel_id_snapshot),
          type: row.event_type,
          fromRank:
            row.from_rank === null || row.from_rank === undefined
              ? null
              : rank(row.from_rank),
          toRank: rank(row.to_rank),
          occurredAt: timestamp(row.occurred_at)
        });
      });
      return Object.freeze({
        works: Object.freeze(works),
        events: Object.freeze(events)
      });
    }
  });
}
