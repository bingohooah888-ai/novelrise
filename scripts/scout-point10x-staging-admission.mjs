// Trusted main-only approval contract for beta Scout Point 10x Staging.
// This file performs no DB access, SQL, migration, or outbound request.
import { readFileSync } from 'node:fs';

export const PREFIX = 'NOVELIGHT_STAGING_READER_POINT10X_APPROVE ';
export const CLAIM = 'NOVELIGHT_STAGING_READER_POINT10X_CLAIMED ';
export const CONSUMED = 'NOVELIGHT_STAGING_READER_POINT10X_CONSUMED ';
export const SCOPE = 'reader-reward-beta-point-10x-staging';
export const STAGING_REF = 'wmlzjgvxgoyrovdhbqbg';
const OWNER = 'bingohooah888-ai';
const REPOSITORY = OWNER + '/novelrise';
const SHA = /^[0-9a-f]{40}$/u;
const VERSION = /^20[0-9]{12}$/u;
const KEYS = [
  'scope',
  'mode',
  'mainSha',
  'candidateSha',
  'pr',
  'stagingRef',
  'version',
  'confirmation'
];
const CLAIM_KEYS = ['requestCommentId', 'mainSha', 'candidateSha', 'runId'];
const CONSUMED_KEYS = [...CLAIM_KEYS, 'result'];
function deny(message) {
  throw new Error('SCOUT_POINT10X_STAGING_DENIED: ' + message);
}
function validObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
function parse(body, prefix, keys) {
  if (
    typeof body !== 'string' ||
    body.length > 1600 ||
    !body.startsWith(prefix)
  )
    deny('unexpected prefix or length');
  let obj;
  try {
    obj = JSON.parse(body.slice(prefix.length));
  } catch {
    deny('invalid JSON');
  }
  if (
    !validObject(obj) ||
    Object.keys(obj).sort().join('|') !== [...keys].sort().join('|')
  )
    deny('noncanonical fields');
  return obj;
}
export function scoutPointTenfoldSqlPins(files, version) {
  if (
    !VERSION.test(version) ||
    !Array.isArray(files) ||
    files.length < 4 ||
    files.length > 100
  )
    deny('invalid candidate SQL manifest');
  const paths = {
    migration: 'supabase/migrations/' + version + '_reader_reward_point10x.sql',
    precheck:
      'supabase/checks/' + version + '_reader_reward_point10x_precheck.sql',
    postcheck:
      'supabase/checks/' + version + '_reader_reward_point10x_postcheck.sql',
    rollback:
      'supabase/rollback/' + version + '_reader_reward_point10x_rollback.sql'
  };
  const artifacts = {};
  for (const [kind, path] of Object.entries(paths)) {
    const a = files.filter((f) => f.filename === path);
    if (a.length !== 1 || a[0].status !== 'added' || !SHA.test(a[0].sha || ''))
      deny('missing SHA-pinned ' + kind);
    artifacts[kind] = { path, sha: a[0].sha };
  }
  const otherSql = files.filter(
    (f) =>
      f.filename?.endsWith('.sql') &&
      (f.filename.startsWith('supabase/migrations/') ||
        f.filename.startsWith('supabase/checks/') ||
        f.filename.startsWith('supabase/rollback/')) &&
      !Object.values(paths).includes(f.filename)
  );
  if (otherSql.length) deny('unreviewed adjacent SQL');
  if (
    files.some(
      (f) =>
        f.filename?.startsWith('scripts/') ||
        f.filename?.startsWith('.github/workflows/') ||
        f.filename?.startsWith('api/') ||
        f.filename === 'AGENTS.md' ||
        f.filename === 'docs/NOVELIGHT-MASTER.md'
    )
  )
    deny('candidate changes trusted code or security policy');
  return Object.freeze(artifacts);
}
export function verifyScoutPointTenfoldAdmission({
  repository,
  actor,
  triggeringActor,
  issue,
  comment,
  main,
  pr,
  compare,
  files,
  ledgerPages
}) {
  if (
    repository !== REPOSITORY ||
    actor !== OWNER ||
    triggeringActor !== OWNER ||
    issue?.number !== 294 ||
    issue.state !== 'open' ||
    issue.title !== '[Staging Control] Supabase migration sync' ||
    issue.pull_request ||
    issue.user?.login !== OWNER
  )
    deny('invalid Issue #294 or actor');
  if (
    !Number.isSafeInteger(comment?.id) ||
    comment.id < 1 ||
    comment.user?.login !== OWNER ||
    comment.author_association !== 'OWNER'
  )
    deny('GitHub OWNER comment required');
  const x = parse(comment.body, PREFIX, KEYS);
  if (
    x.scope !== SCOPE ||
    x.mode !== 'rollback-only' ||
    x.stagingRef !== STAGING_REF ||
    x.confirmation !== 'STAGING APPROVED' ||
    !Number.isSafeInteger(x.pr) ||
    x.pr < 1 ||
    !SHA.test(x.mainSha || '') ||
    !SHA.test(x.candidateSha || '') ||
    !VERSION.test(x.version || '')
  )
    deny('scope, mode, SHA, version or project mismatch');
  if (main?.object?.sha !== x.mainSha || x.mainSha === x.candidateSha)
    deny('main SHA binding failed');
  if (
    pr?.number !== x.pr ||
    pr?.state !== 'open' ||
    pr.draft !== true ||
    pr.merged === true ||
    pr.base?.ref !== 'main' ||
    pr.base.sha !== x.mainSha ||
    pr.head?.repo?.full_name !== REPOSITORY ||
    pr.head.sha !== x.candidateSha ||
    pr.changed_files !== files?.length ||
    pr.changed_files > 100
  )
    deny('PR identity/head/scope drift');
  if (
    compare?.status !== 'ahead' ||
    compare.behind_by !== 0 ||
    compare.base_commit?.sha !== x.mainSha ||
    !Array.isArray(compare.commits) ||
    compare.total_commits !== compare.commits.length ||
    compare.commits.at(-1)?.sha !== x.candidateSha
  )
    deny('candidate not exact descendant');
  if (
    !Array.isArray(ledgerPages) ||
    ledgerPages.length < 1 ||
    ledgerPages.length > 40 ||
    ledgerPages.some((page) => !Array.isArray(page) || page.length > 100) ||
    ledgerPages.at(-1).length === 100
  )
    deny('incomplete Issue #294 ledger pagination');
  for (const e of ledgerPages.flat()) {
    if (!e || typeof e.body !== 'string') deny('invalid ledger item');
    const marker = [CLAIM, CONSUMED].find((y) => e.body.startsWith(y));
    if (!marker) continue;
    const used = parse(
      e.body,
      marker,
      marker === CLAIM ? CLAIM_KEYS : CONSUMED_KEYS
    );
    if (String(used.requestCommentId) === String(comment.id))
      deny('approval claimed or consumed');
  }
  const artifacts = scoutPointTenfoldSqlPins(files, x.version);
  return Object.freeze({
    scope: SCOPE,
    mode: 'rollback-only',
    stagingRef: STAGING_REF,
    mainSha: x.mainSha,
    candidateSha: x.candidateSha,
    pr: x.pr,
    version: x.version,
    requestCommentId: String(comment.id),
    artifacts,
    mayPersistStaging: false,
    mayWriteProduction: false,
    requiresBackupRestoreProof: true
  });
}
if (process.argv[2] === 'validate') {
  try {
    if (process.argv.length !== 9) deny('six JSON inputs required');
    const read = (x) => JSON.parse(readFileSync(x, 'utf8'));
    const [eventPath, mainPath, prPath, comparePath, filesPath, ledgerPath] =
      process.argv.slice(3);
    const event = read(eventPath);
    const r = verifyScoutPointTenfoldAdmission({
      repository: event.repository?.full_name,
      actor: process.env.GITHUB_ACTOR,
      triggeringActor: process.env.GITHUB_TRIGGERING_ACTOR,
      issue: event.issue,
      comment: event.comment,
      main: read(mainPath),
      pr: read(prPath),
      compare: read(comparePath),
      files: read(filesPath),
      ledgerPages: read(ledgerPath)
    });
    process.stdout.write(JSON.stringify(r) + '\n');
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
