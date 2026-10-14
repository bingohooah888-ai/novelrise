// Controlled SQL-only evaluation, never an arbitrary PR-code execution.
// Pinned immutable Git blob hashes MUST be verified by the trusted workflow.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const COMMUNITY_CANDIDATE_ARTIFACTS = Object.freeze([
  {
    path: 'supabase/checks/20261014052000_community_plaza_phase1_precheck.sql',
    blob: 'cc6f0bdd4dcff975852d99018c88dac02abd93bb',
    closing: 'ROLLBACK'
  },
  {
    path: 'supabase/migrations/20261014052000_community_plaza_phase1.sql',
    blob: '1f5ef773a4073f10cc2e1b886eb3a8c942beb5c4',
    closing: 'COMMIT'
  },
  {
    path: 'supabase/checks/20261014052000_community_plaza_phase1_postcheck.sql',
    blob: 'b328980f483acfe738ae066dc430dd6d02b63687',
    closing: 'ROLLBACK'
  },
  {
    path: 'tests/rls/community-plaza-phase1-security.sql',
    blob: '3503bc992bd7c05a6105f3529ce6764e3b5c862c',
    closing: 'ROLLBACK'
  }
]);

function fail(reason) {
  throw new Error('COMMUNITY_STAGING_SQL_DENIED: ' + reason);
}

function unwrapSQL(text, closing) {
  if (typeof text !== 'string' || text.length > 150000 ||
    text.includes('\0')) fail('invalid SQL artifact');
  const lines = text.replaceAll('\r\n', '\n').split('\n');
  const beginCount = lines.filter((l) => /^\s*BEGIN;\s*$/iu.test(l)).length;
  const commitCount = lines.filter((l) => /^\s*COMMIT;\s*$/iu.test(l)).length;
  const rollbackCount = lines.filter((l) => /^\s*ROLLBACK;\s*$/iu.test(l)).length;
  if (beginCount !== 1 || (closing === 'COMMIT'
    ? commitCount !== 1 || rollbackCount !== 0
    : commitCount !== 0 || rollbackCount !== 1)) {
    fail('artifact does not have the exact BEGIN/closing wrapper');
  }
  const body = [];
  let removedBegin = false;
  let removedEnd = false;
  for (const line of lines) {
    if (/^\s*\\/u.test(line)) {
      if (/^\s*\\set ON_ERROR_STOP on\s*$/iu.test(line)) continue;
      fail('psql metacommand forbidden');
    }
    if (/^\s*BEGIN;\s*$/iu.test(line)) {
      removedBegin = true;
      continue;
    }
    if (new RegExp('^\\s*' + closing + ';\\s*$', 'iu').test(line)) {
      removedEnd = true;
      continue;
    }
    body.push(line);
  }
  if (!removedBegin || !removedEnd) fail('missing transaction delimiter');
  const sql = body.join('\n');
  if (/^\s*(COMMIT|ROLLBACK|SAVEPOINT|PREPARE TRANSACTION|COPY)\b/imu.test(sql)) {
    fail('unreviewed transaction or import command');
  }
  return sql;
}

export function composeCommunityRollbackOnlySQL(contents) {
  if (!Array.isArray(contents) ||
    contents.length !== COMMUNITY_CANDIDATE_ARTIFACTS.length) {
    fail('incorrect number of reviewed SQL artifacts');
  }
  const sections = contents.map((content, i) => unwrapSQL(
    content, COMMUNITY_CANDIDATE_ARTIFACTS[i].closing
  ));
  return [
    '-- Fixed reviewed SQL in a single transaction. No migration ledger writes.',
    '\\set ON_ERROR_STOP on',
    'BEGIN;',
    "SET LOCAL statement_timeout = '120s';",
    "SET LOCAL lock_timeout = '5s';",
    "SET LOCAL idle_in_transaction_session_timeout = '180s';",
    ...sections,
    '-- Always undo the schema changes and any simulated user operations.',
    'ROLLBACK;',
    ''
  ].join('\n');
}

if (process.argv[2] === 'manifest') {
  for (const artifact of COMMUNITY_CANDIDATE_ARTIFACTS) {
    process.stdout.write(artifact.path + '|' + artifact.blob + '\n');
  }
}
if (process.argv[2] === 'compose') {
  try {
    const root = process.argv[3];
    if (!root || process.argv.length !== 4) fail('exact artifact root required');
    const sql = composeCommunityRollbackOnlySQL(
      COMMUNITY_CANDIDATE_ARTIFACTS.map((a) =>
        readFileSync(join(root, a.path), 'utf8'))
    );
    process.stdout.write(sql);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
