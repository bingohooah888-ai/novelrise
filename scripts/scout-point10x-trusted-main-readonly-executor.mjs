// NOVELIGHT Point10x: byte-pinned, fail-closed read-only executor kernel.
// REVIEW ONLY: no exported live capability, GitHub/CONTROL/DB adapter, secret access,
// workflow trigger, or automatic activation. Do not treat fake transport as authorization.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('../', import.meta.url);
const SOURCES = Object.freeze([
  {
    path: 'docs/plans/READER-REWARD-POINT10X-STAGING-CATALOG-READONLY-20261105.sql',
    sha256: '740cc8c94b7e2831aae29e740282b826bee730621ab56627b03a8e1062e2ee11',
    prefix: 'CATALOG',
    count: 8
  },
  {
    path: 'docs/plans/READER-REWARD-POINT10X-STAGING-PRIVILEGED-CATALOG-ADDENDUM-20261105.sql',
    sha256: '6dd649cc7fa4c824f6f576500a5a7e44ce65bce3123e6a4990b06353114650d1',
    prefix: 'GAP',
    count: 3
  }
]);
export const READONLY_SCOPE =
  'reader-reward-beta-point-10x-staging-catalog-single-snapshot-readonly';
export const READONLY_OPERATION = 'read-catalog-11-same-snapshot';
export const CONTROL_ISSUE = 294;
export const STAGING_REF = 'wmlzjgvxgoyrovdhbqbg';
export const PRODUCTION_REF = 'fiepaguycecrredwrcwx';
export const READONLY_BEGIN =
  'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY';
export const READONLY_IDS = Object.freeze([
  ...Array.from(
    { length: 8 },
    (_, i) => 'NL-CATALOG-' + String(i + 1).padStart(2, '0')
  ),
  ...Array.from(
    { length: 3 },
    (_, i) => 'NL-GAP-' + String(i + 1).padStart(2, '0')
  )
]);
export const LIVE_RUNTIME_ENABLED = false;
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fail = (code) => {
  throw new Error('POINT10X_READONLY_HOLD:' + code);
};
const exactKeys = (x, keys) =>
  x &&
  typeof x === 'object' &&
  !Array.isArray(x) &&
  Object.keys(x).length === keys.length &&
  keys.every((k) => Object.hasOwn(x, k));
const hex40 = (x) => typeof x === 'string' && /^[0-9a-f]{40}$/u.test(x);
const hex64 = (x) => typeof x === 'string' && /^[0-9a-f]{64}$/u.test(x);

function extractPinnedPack(fileBytes, source) {
  if (!Buffer.isBuffer(fileBytes) || digest(fileBytes) !== source.sha256)
    fail('SOURCE_SHA256_MISMATCH');
  const text = fileBytes.toString('utf8');
  if (Buffer.from(text, 'utf8').compare(fileBytes) !== 0)
    fail('INVALID_SOURCE_ENCODING');
  const begin =
    /^BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;$/gmu;
  const rollback = /^ROLLBACK;$/gmu;
  const beginMatches = [...text.matchAll(begin)];
  const rollbackMatches = [...text.matchAll(rollback)];
  if (
    beginMatches.length !== 1 ||
    rollbackMatches.length !== 1 ||
    beginMatches[0].index >= rollbackMatches[0].index
  )
    fail('SOURCE_TRANSACTION_BOUNDARY');
  const sections = [
    ...text.matchAll(/^-- (NL-(?:CATALOG|GAP)-\d{2}):[^\r\n]*\r?\n/gmu)
  ];
  if (sections.length !== source.count) fail('SECTION_COUNT_MISMATCH');
  const statements = sections.map((match, i) => {
    const id = 'NL-' + source.prefix + '-' + String(i + 1).padStart(2, '0');
    if (match[1] !== id) fail('SECTION_ORDER_MISMATCH');
    const end =
      i + 1 < sections.length
        ? sections[i + 1].index
        : rollbackMatches[0].index;
    const sql = text.slice(match.index + match[0].length, end).trim();
    const normalized = sql
      .replace(/^(?:--[^\r\n]*(?:\r?\n|$)\s*)+/gu, '')
      .trim();
    if (
      !/^(?:SELECT|WITH)\s/iu.test(normalized) ||
      !sql.endsWith(';') ||
      (sql.match(/;/gu) || []).length !== 1 ||
      /\\(?:connect|copy|!)/iu.test(sql)
    )
      fail('NON_SELECT_OR_ESCAPE');
    return Object.freeze({ id, sql, sha256: digest(Buffer.from(sql, 'utf8')) });
  });
  if (sections[0].index <= beginMatches[0].index)
    fail('SOURCE_STATEMENT_POSITION');
  return statements;
}

// Only the two byte-exact, immutable SQL files are accepted. No path/SQL arguments.
export function compilePinnedReadOnlyBatch() {
  const items = SOURCES.flatMap((source) =>
    extractPinnedPack(
      readFileSync(fileURLToPath(new URL(source.path, ROOT))),
      source
    )
  );
  if (
    items.length !== READONLY_IDS.length ||
    items.some((x, i) => x.id !== READONLY_IDS[i])
  )
    fail('ELEVEN_STATEMENT_MANIFEST_INVALID');
  const manifestDigest = digest(
    Buffer.from(
      items.map(({ id, sha256 }) => id + ':' + sha256).join('\n'),
      'utf8'
    )
  );
  return Object.freeze({
    scope: READONLY_SCOPE,
    operation: READONLY_OPERATION,
    issue: CONTROL_ISSUE,
    stagingRef: STAGING_REF,
    sources: Object.freeze(SOURCES.map(({ sha256 }) => sha256)),
    manifestDigest,
    begin: READONLY_BEGIN,
    end: 'ROLLBACK',
    statements: Object.freeze(items),
    liveEnabled: false
  });
}

// No credential-bearing runtime entry point exists in this PR.
// A user-controlled object, Boolean, or synthetic approval must not enable it.
export async function runTrustedMainReadOnly() {
  fail('NO_LIVE_OWNER_CONTROL_ROLE_OR_AUDIT_ADAPTER');
}

// Execute the approved command order through one session. This PRIVATE kernel
// has no external adapter constructor; the only caller below builds a local
// in-memory recorder. Future live wiring requires a separately approved trust gate.
async function driveOneSession(connection, batch) {
  let completed = 0;
  let problem = '';
  try {
    if ((await connection.execute(READONLY_BEGIN)).ack !== true)
      fail('BEGIN_ACK_UNKNOWN');
    for (const item of batch.statements) {
      const response = await connection.execute(item.sql);
      if (
        !response ||
        response.ack !== true ||
        response.id !== item.id ||
        !hex64(response.resultDigest) ||
        !Number.isSafeInteger(response.rowCount) ||
        response.rowCount < 0
      )
        fail('SELECT_RESULT_UNTRUSTED');
      completed++;
    }
  } catch {
    problem = 'SELECT_OR_BEGIN_FAILED';
  }
  // Never COMMIT. On failure do not replay partial results or re-connect.
  let rolledBack = false;
  let closed = false;
  try {
    rolledBack = (await connection.execute('ROLLBACK')).ack === true;
  } catch {
    rolledBack = false;
  }
  try {
    closed = (await connection.close()).ack === true;
  } catch {
    closed = false;
  }
  if (!rolledBack || !closed) fail('ROLLBACK_OR_CLOSE_ACK_UNKNOWN');
  if (problem || completed !== 11) fail('INCOMPLETE_SINGLE_SESSION');
  return completed;
}

// Tests exercise actual BEGIN -> 11 fixed SELECTs -> ROLLBACK -> CLOSE
// through a deterministic local recorder. Never passes real DB connections,
// credentials or live transport into this module.
export async function exerciseInertSingleSession({
  batch,
  transcript,
  fault = null
} = {}) {
  if (
    !batch ||
    batch.liveEnabled !== false ||
    batch.scope !== READONLY_SCOPE ||
    batch.operation !== READONLY_OPERATION ||
    batch.stagingRef !== STAGING_REF ||
    batch.begin !== READONLY_BEGIN ||
    batch.end !== 'ROLLBACK' ||
    !hex64(batch.manifestDigest) ||
    !Array.isArray(batch.statements) ||
    batch.statements.length !== 11 ||
    batch.statements.some(
      (s, i) =>
        s.id !== READONLY_IDS[i] ||
        !hex64(s.sha256) ||
        digest(Buffer.from(s.sql || '', 'utf8')) !== s.sha256
    )
  )
    fail('BATCH_INVALID');
  const expected = compilePinnedReadOnlyBatch();
  if (
    expected.manifestDigest !== batch.manifestDigest ||
    batch.statements.some((s, i) => s.sha256 !== expected.statements[i].sha256)
  )
    fail('UNPINNED_STATEMENT');
  if (
    !exactKeys(transcript, [
      'transport',
      'connections',
      'sessions',
      'transactions',
      'isolation',
      'access',
      'commands',
      'rollbackAck',
      'closeAck',
      'results'
    ])
  )
    fail('TRANSCRIPT_CONTRACT');
  if (
    transcript.transport !== 'DETERMINISTIC_IN_MEMORY_NO_DATABASE' ||
    transcript.connections !== 1 ||
    transcript.sessions !== 1 ||
    transcript.transactions !== 1 ||
    transcript.isolation !== 'REPEATABLE READ' ||
    transcript.access !== 'READ ONLY' ||
    transcript.rollbackAck !== true ||
    transcript.closeAck !== true ||
    !Array.isArray(transcript.commands) ||
    !Array.isArray(transcript.results)
  )
    fail('TRANSCRIPT_BOUNDARY');
  const expectedCommands = [
    READONLY_BEGIN,
    ...READONLY_IDS,
    'ROLLBACK',
    'CLOSE'
  ];
  if (
    JSON.stringify(transcript.commands) !== JSON.stringify(expectedCommands) ||
    transcript.results.length !== 11 ||
    transcript.results.some(
      (r, i) =>
        !exactKeys(r, ['id', 'resultDigest', 'rowCount', 'snapshotTag']) ||
        r.id !== READONLY_IDS[i] ||
        !hex64(r.resultDigest) ||
        !Number.isSafeInteger(r.rowCount) ||
        r.rowCount < 0 ||
        r.snapshotTag !== transcript.results[0].snapshotTag
    )
  )
    fail('TRANSCRIPT_SPLIT_OR_INCOMPLETE');
  if (
    typeof transcript.results[0].snapshotTag !== 'string' ||
    !/^synthetic-[a-z0-9-]{3,40}$/u.test(transcript.results[0].snapshotTag)
  )
    fail('SNAPSHOT_TAG_INVALID');
  if (![null, 'begin', 'select-5', 'rollback', 'close'].includes(fault))
    fail('UNSUPPORTED_FAULT_INJECTION');
  const executed = [];
  const fake = {
    async execute(sql) {
      if (sql === 'ROLLBACK') {
        executed.push('ROLLBACK');
        return { ack: fault !== 'rollback' };
      }
      const index = executed.length;
      const expectedSql =
        index === 0 ? READONLY_BEGIN : batch.statements[index - 1]?.sql;
      if (sql !== expectedSql) fail('UNEXPECTED_SESSION_COMMAND');
      executed.push(index === 0 ? READONLY_BEGIN : READONLY_IDS[index - 1]);
      if (fault === 'begin' && index === 0) return { ack: false };
      if (fault === 'select-5' && index === 5)
        throw new Error('synthetic select failure');
      if (index === 0) return { ack: true };
      return { ack: true, ...transcript.results[index - 1] };
    },
    async close() {
      executed.push('CLOSE');
      return { ack: fault !== 'close' };
    }
  };
  const checkedSections = await driveOneSession(fake, batch);
  if (JSON.stringify(executed) !== JSON.stringify(expectedCommands))
    fail('RECORDED_COMMANDS_MISMATCH');
  return Object.freeze({
    status: 'NO_GO_OFFLINE_KERNEL_VERIFIED',
    manifestDigest: batch.manifestDigest,
    checkedSections,
    actualDbConnected: false,
    ownerAuthenticated: false,
    controlSpentCommitted: false,
    realSnapshotProven: false,
    mayRunStaging: false,
    mayMergeMain: false,
    noAutomaticRetry: true
  });
}

export function inspectFutureOwnerRequest({
  claim,
  mainSha,
  headSha,
  manifestDigest
} = {}) {
  if (
    !exactKeys(claim, [
      'scope',
      'operation',
      'issue',
      'mainSha',
      'headSha',
      'stagingRef',
      'manifestDigest',
      'runCount'
    ]) ||
    claim.scope !== READONLY_SCOPE ||
    claim.operation !== READONLY_OPERATION ||
    claim.issue !== CONTROL_ISSUE ||
    claim.stagingRef !== STAGING_REF ||
    claim.runCount !== 1 ||
    !hex40(mainSha) ||
    !hex40(headSha) ||
    claim.mainSha !== mainSha ||
    claim.headSha !== headSha ||
    !hex64(manifestDigest) ||
    claim.manifestDigest !== manifestDigest
  )
    return Object.freeze({
      status: 'HOLD_UNVERIFIED_OWNER_SCOPE',
      ownerAuthenticated: false
    });
  // Shape check is not a GitHub OWNER verification, CAS, or permission.
  return Object.freeze({
    status: 'NO_GO_OWNER_SHAPE_ONLY',
    ownerAuthenticated: false
  });
}
