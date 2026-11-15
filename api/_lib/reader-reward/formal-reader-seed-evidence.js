// Reader-owned LIGHT SEED discovery history, formal release ONLY.
// SQL is read-only, uses existing event / XP ledgers and verified user scope.
// Never infer paid XP from seed_discovery_state.cumulative_discovery_xp:
// historical Lv30 caps may have prevented an actual Scout XP ledger credit.
// No connection, endpoint, job, migration, XP backfill or Rank score exposed.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GRADES = new Set(['GOLD', 'SILVER', 'BRONZE']);
const LIMIT = 60;
const EVENT_LIMIT = 500;
const SEED_SQL =
  'select s.seed_id,s.reader_id,s.seed_type,s.rank_at_seed,' +
  's.highest_rank_seen,s.best_rank_delta,s.window_expires_at,s.updated_at,' +
  "case when n.status='published' then n.title else null end as novel_title " +
  'from public.seed_discovery_state s ' +
  'left join public.novels n on n.id::text=s.novel_id_snapshot ' +
  'where s.reader_id=$1::uuid ' +
  'order by s.updated_at desc,s.seed_id desc limit 61';
const EVENTS_SQL =
  'select e.id,e.seed_id,e.user_id,e.occurred_at,' +
  "e.metadata->>'seed_type' as event_seed_type," +
  "e.metadata->>'rank_at_seed' as event_rank_at_seed," +
  "e.metadata->>'reached_rank' as reached_rank," +
  "e.metadata->>'delta_xp' as proposed_delta_xp," +
  'x.xp_value as credited_xp ' +
  'from public.scout_event_ledger e ' +
  'left join public.scout_xp_ledger x ' +
  "on x.source_event_id=e.id and x.user_id=e.user_id and x.xp_kind='light_seed_discovery' " +
  "where e.user_id=$1::uuid and e.event_type='light_seed_discovery' " +
  'and e.seed_id=any($2::uuid[]) ' +
  'order by e.occurred_at,e.id limit 501';

function uuid(value) {
  if (typeof value !== 'string' || !UUID.test(value))
    throw new Error('FORMAL_READER_SEED_IDENTITY_INVALID');
  return value.toLowerCase();
}
function number(value, min, max) {
  const parsed =
    typeof value === 'string' && /^\d+$/.test(value)
      ? Number(value)
      : value;
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max)
    throw new Error('FORMAL_READER_SEED_VALUE_INVALID');
  return parsed;
}
function instant(value) {
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch))
    throw new Error('FORMAL_READER_SEED_TIMESTAMP_INVALID');
  return new Date(epoch).toISOString();
}

export function createFormalReaderSeedEvidenceReader({ query } = {}) {
  if (typeof query !== 'function')
    throw new TypeError('Trusted PostgreSQL read executor required');

  return Object.freeze({
    async read(readerId) {
      const owner = uuid(readerId);
      const seedRows = await query(SEED_SQL, [owner]);
      if (!Array.isArray(seedRows?.rows) || seedRows.rows.length > LIMIT + 1)
        throw new Error('FORMAL_READER_SEED_SOURCE_UNAVAILABLE');
      const moreSeedsAvailable = seedRows.rows.length > LIMIT;
      const seeds = new Map();
      for (const row of seedRows.rows.slice(0, LIMIT)) {
        const id = uuid(row?.seed_id);
        if (
          uuid(row?.reader_id) !== owner ||
          seeds.has(id) ||
          !GRADES.has(row.seed_type)
        )
          throw new Error('FORMAL_READER_SEED_SCOPE_INVALID');
        const firstRank = number(row.rank_at_seed, 1, 6);
        const highestRank = number(row.highest_rank_seen, firstRank, 6);
        const growth = number(row.best_rank_delta, 0, 5);
        if (growth > highestRank - firstRank)
          throw new Error('FORMAL_READER_SEED_GROWTH_INVALID');
        const expires = instant(row.window_expires_at);
        const updated = instant(row.updated_at);
        if (
          row.novel_title !== null &&
          row.novel_title !== undefined &&
          typeof row.novel_title !== 'string'
        )
          throw new Error('FORMAL_READER_SEED_TITLE_INVALID');
        seeds.set(id, {
          id,
          grade: row.seed_type,
          firstRank,
          highestRank,
          growth,
          expires,
          updated,
          title:
            typeof row.novel_title === 'string'
              ? row.novel_title.slice(0, 140)
              : null,
          stages: [],
          creditedXp: 0,
          missingXpEvidence: 0
        });
      }
      if (!seeds.size)
        return Object.freeze({
          status: 'formal_reader_seed_evidence_review_only',
          items: Object.freeze([]),
          moreSeedsAvailable,
          independentlyVerifiedEntireLedger: false,
          historicalXpBackfillAllowed: false,
          mayIssueXp: false,
          readyForPublicRelease: false
        });

      const eventRows = await query(EVENTS_SQL, [owner, [...seeds.keys()]]);
      if (
        !Array.isArray(eventRows?.rows) ||
        eventRows.rows.length > EVENT_LIMIT
      )
        throw new Error('FORMAL_READER_SEED_EVENT_HISTORY_TRUNCATED');
      const eventIds = new Set();
      for (const row of eventRows.rows) {
        const eventId = uuid(row?.id);
        const seedId = uuid(row?.seed_id);
        const seed = seeds.get(seedId);
        if (
          !seed ||
          uuid(row.user_id) !== owner ||
          eventIds.has(eventId) ||
          row.event_seed_type !== seed.grade
        )
          throw new Error('FORMAL_READER_SEED_EVENT_SCOPE_INVALID');
        eventIds.add(eventId);
        const initial = number(row.event_rank_at_seed, 1, 6);
        const reached = number(row.reached_rank, 1, 6);
        const claimed = number(row.proposed_delta_xp, 1, 1000000);
        const at = instant(row.occurred_at);
        const eventMs = Date.parse(at);
        const expiryMs = Date.parse(seed.expires);
        const rankGain = reached - initial;
        const novaPrediction = initial === 5 && reached === 6;
        if (
          initial !== seed.firstRank ||
          reached > seed.highestRank ||
          eventMs < expiryMs - 180 * 86400000 ||
          eventMs > expiryMs ||
          (!novaPrediction && (rankGain < 2 || rankGain > 5))
        )
          throw new Error('FORMAL_READER_SEED_STAGE_INVALID');
        const evidencePresent =
          row.credited_xp !== null && row.credited_xp !== undefined;
        const credited = evidencePresent
          ? number(row.credited_xp, 0, claimed)
          : null;
        if (credited === null) {
          seed.missingXpEvidence++;
        } else {
          seed.creditedXp += credited;
          if (!Number.isSafeInteger(seed.creditedXp))
            throw new Error('FORMAL_READER_SEED_XP_OVERFLOW');
        }
        seed.stages.push(
          Object.freeze({
            stage: novaPrediction ? 'NOVA_prediction' : 'growth_' + rankGain,
            occurredAt: at,
            // Actual XP ledger credit, not the event's theoretical reward.
            ledgerCreditedXp: credited,
            creditLedgerVerified: evidencePresent,
            // Legacy Lv30 caps can reduce or suppress the credited XP.
            claimedDeltaMatchesLedger:
              credited === null ? false : credited === claimed
          })
        );
      }
      const items = [...seeds.values()].map((seed) =>
        Object.freeze({
          seedId: seed.id,
          grade: seed.grade,
          workTitle: seed.title,
          growth: seed.growth,
          novaPrediction:
            seed.firstRank === 5 && seed.highestRank === 6,
          expiresAt: seed.expires,
          updatedAt: seed.updated,
          stages: Object.freeze(seed.stages),
          recordedCreditedXp: seed.creditedXp,
          missingXpEvidenceEvents: seed.missingXpEvidence
        })
      );
      return Object.freeze({
        status: 'formal_reader_seed_evidence_review_only',
        items: Object.freeze(items),
        moreSeedsAvailable,
        independentlyVerifiedEntireLedger: false,
        historicalXpBackfillAllowed: false,
        mayIssueXp: false,
        readyForPublicRelease: false
      });
    }
  });
}
