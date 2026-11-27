// Offline contracts only. No provider, route, database, or log ingestion.
// Callers must establish the principal and scope from trusted server records.
import { assertAiWorkAccess } from './context.js';

const GROUPS = ['new_to_work', 'returning_to_work'];
const MIN_SAMPLE = 50;
const MIN_CELL = 10;
const SERVICES = [
  'admin-reports',
  'admin-community',
  'admin-trust-safety',
  'admin-dashboard',
  'thumbnail-render'
];
const CLASSES = ['4xx', '5xx', 'timeout', 'render_failed'];

function invalid() {
  throw new Error('AI_OFFLINE_AGGREGATE_INVALID');
}

function exactFields(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  if (Object.keys(value).length !== keys.length) invalid();
  if (!keys.every((key) => Object.hasOwn(value, key))) invalid();
}

function count(value) {
  if (!Number.isSafeInteger(value) || value < 0) invalid();
  return value;
}

function parseOutput(text, keys) {
  if (typeof text !== 'string') invalid();
  if (Buffer.byteLength(text, 'utf8') > 8000) invalid();
  let result;
  try {
    result = JSON.parse(text);
  } catch {
    invalid();
  }
  exactFields(result, keys);
  return result;
}

// Future aggregate adapter contract, not an existing live cohort query.
// Counts must be unique reader/work cohorts, same observation window and
// mutually exclusive groups. The caller must verify these facts upstream.
// Never accept per-reader identifiers, sensitive attributes or free labels.
export function projectTargetReaderAggregates({ principal, novel, snapshot }) {
  assertAiWorkAccess({ principal, novel, audience: 'author' });
  exactFields(snapshot, ['novelId', 'days', 'groups']);
  if (String(snapshot.novelId) !== String(novel.id)) invalid();
  if (![7, 30, 90].includes(snapshot.days)) invalid();
  if (!Array.isArray(snapshot.groups)) invalid();
  if (snapshot.groups.length !== 2) invalid();
  const seen = new Set();
  const groups = snapshot.groups.map((row) => {
    exactFields(row, ['group', 'started', 'continued']);
    if (!GROUPS.includes(row.group) || seen.has(row.group)) invalid();
    seen.add(row.group);
    const started = count(row.started);
    const continued = count(row.continued);
    if (continued > started) invalid();
    // Suppress both groups together to avoid exposing a small comparison
    // cell or its complement by subtraction. Not a full anonymity guarantee.
    if (started < MIN_SAMPLE || continued < MIN_CELL) return null;
    if (started - continued < MIN_CELL) return null;
    return {
      group: row.group,
      started,
      continued,
      rate: Math.round((continued / started) * 1000) / 10
    };
  });
  if (groups.some((row) => row === null)) {
    return { kind: 'insufficient_aggregate', days: snapshot.days, groups: [] };
  }
  return {
    kind: 'observed_aggregate_only',
    days: snapshot.days,
    groups: GROUPS.map((group) => groups.find((row) => row.group === group))
  };
}

// The model may select only a disclosed comparison, never provide numeric
// values, demographics, causal claims, reader identities or rankings.
export function reviewTargetReaderComparison(input) {
  const projection = projectTargetReaderAggregates(input);
  const output = parseOutput(input.modelText, ['groups']);
  if (!Array.isArray(output.groups)) invalid();
  if (output.groups.length !== 2) invalid();
  if (!GROUPS.every((group) => output.groups.includes(group))) invalid();
  if (projection.kind !== 'observed_aggregate_only') return projection;
  const [first, second] = projection.groups;
  return {
    ...projection,
    differencePoints: Math.round((first.rate - second.rate) * 10) / 10,
    interpretation: 'observed_difference_not_causal'
  };
}

// Only a future authenticated admin adapter may provide structured counts.
// No raw log messages, headers, query strings, IPs, emails or request IDs
// enter this contract; no arbitrary strings are copied to the result.
export function projectIncidentCounts({ days, rows }) {
  if (![1, 7, 30].includes(days)) invalid();
  if (!Array.isArray(rows) || rows.length > 20) invalid();
  const seen = new Set();
  const counts = rows.map((row) => {
    exactFields(row, ['service', 'failureClass', 'count']);
    if (!SERVICES.includes(row.service)) invalid();
    if (!CLASSES.includes(row.failureClass)) invalid();
    const key = row.service + ':' + row.failureClass;
    if (seen.has(key)) invalid();
    seen.add(key);
    return { key, count: count(row.count) };
  });
  return { days, counts };
}

export function reviewIncidentSummary(input) {
  const projection = projectIncidentCounts(input);
  const output = parseOutput(input.modelText, ['keys']);
  if (!Array.isArray(output.keys) || output.keys.length > 5) invalid();
  if (new Set(output.keys).size !== output.keys.length) invalid();
  const selected = output.keys.map((key) => {
    const row = projection.counts.find((item) => item.key === key);
    if (!row || row.count === 0) invalid();
    return row;
  });
  return {
    kind: 'observed_incident_counts',
    days: projection.days,
    items: selected,
    rootCauseVerified: false
  };
}
