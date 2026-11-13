// Dormant, trusted-main Staging-only one-reader proof; no Preview, deletion,
// external Point issue/spend, or historical Point conversion.
import { readFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyStagingMigrationTarget } from './verify-staging-migration-target.mjs';

const REF = 'wmlzjgvxgoyrovdhbqbg';
const URL = 'https://' + REF + '.supabase.co';
const TEST_AT = '2026-11-10T00:00:00.000Z';
const PREFIX = 'NOVELIGHT_STAGING_NEW_READER_ONE_APPROVE ';
const CLAIM = 'NOVELIGHT_STAGING_NEW_READER_ONE_CLAIMED ';
const CONSUME = 'NOVELIGHT_STAGING_NEW_READER_ONE_CONSUMED ';
const SHA = /^[a-f0-9]{40}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const FIELDS = [
  'confirmation',
  'mainSha',
  'maxReaders',
  'pr',
  'referenceAt',
  'scope',
  'stagingRef'
];
const fail = () => {
  throw Error('FORMAL_NEW_READER_STAGING_PROOF_DENIED');
};
function decode(s) {
  try {
    return JSON.parse(s);
  } catch {
    fail();
  }
}

export function validateOneReaderApproval({ event, main, ledger, env = {} }) {
  if (
    env.GITHUB_EVENT_NAME !== 'issue_comment' ||
    env.GITHUB_ACTOR !== 'bingohooah888-ai' ||
    env.GITHUB_TRIGGERING_ACTOR !== 'bingohooah888-ai' ||
    event?.action !== 'created' ||
    event?.repository?.full_name !== 'bingohooah888-ai/novelrise' ||
    event?.issue?.number !== 294 ||
    event?.issue?.state !== 'open' ||
    event?.issue?.title !== '[Staging Control] Supabase migration sync' ||
    event?.issue?.pull_request != null ||
    event?.comment?.user?.login !== 'bingohooah888-ai' ||
    event?.comment?.author_association !== 'OWNER' ||
    event?.sender?.login !== 'bingohooah888-ai'
  )
    fail();
  const body = event.comment.body;
  if (typeof body !== 'string' || !body.startsWith(PREFIX)) fail();
  const payload = decode(body.slice(PREFIX.length));
  if (
    !payload ||
    Array.isArray(payload) ||
    Object.keys(payload).sort().join(',') !== FIELDS.slice().sort().join(',') ||
    payload.confirmation !== 'STAGING APPROVED' ||
    payload.scope !== 'formal-new-reader-one-staging-proof' ||
    payload.pr !== 2762 ||
    payload.stagingRef !== REF ||
    payload.referenceAt !== TEST_AT ||
    payload.maxReaders !== 1 ||
    !SHA.test(payload.mainSha || '') ||
    payload.mainSha !== main?.object?.sha
  )
    fail();
  const id = event.comment.id;
  if (!Number.isSafeInteger(id) || id < 1 || !Array.isArray(ledger)) fail();
  const comments = ledger.flat(Infinity);
  if (!comments.some((x) => x?.id === id && x?.body === body)) fail();
  for (const c of comments) {
    const s = String(c?.body ?? '');
    for (const p of [CLAIM, CONSUME]) {
      if (
        s.startsWith(p) &&
        String(decode(s.slice(p.length))?.requestCommentId) === String(id)
      )
        fail();
    }
  }
  return Object.freeze({
    mainSha: payload.mainSha,
    requestCommentId: String(id),
    stagingRef: REF,
    referenceAt: TEST_AT,
    maxReaders: 1
  });
}

export function buildNewReaderSql(id) {
  if (!UUID.test(id || '')) fail();
  // Only the UUID returned by Staging Auth is interpolated; one atomic psql call.
  const u = "'" + id + "'::uuid";
  return [
    'BEGIN;',
    'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;',
    'DO $one_reader$',
    'DECLARE created timestamptz; inserted integer;',
    'BEGIN',
    ' SELECT created_at INTO created FROM auth.users WHERE id=' +
      u +
      ' FOR UPDATE;',
    " IF created IS NULL OR created < '" +
      TEST_AT +
      "'::timestamptz THEN RAISE EXCEPTION 'NOT_SYNTHETIC_READER'; END IF;",
    ' IF EXISTS (SELECT 1 FROM public.scout_point_ledger WHERE user_id=' +
      u +
      ') OR',
    '    EXISTS (SELECT 1 FROM public.scout_xp_ledger WHERE user_id=' +
      u +
      ') OR',
    '    EXISTS (SELECT 1 FROM novelight_formal_private.scout_level_state WHERE user_id=' +
      u +
      ') OR',
    '    EXISTS (SELECT 1 FROM novelight_formal_private.scout_point_usage_wallets WHERE user_id=' +
      u +
      ')',
    " THEN RAISE EXCEPTION 'EXISTING_READER_HISTORY'; END IF;",
    ' INSERT INTO novelight_formal_private.scout_level_state',
    ' (user_id,current_level,highest_level,level_progress_xp,review_anchor_at,revision)',
    ' VALUES (' + u + ',1,1,0,created,0);',
    " GET DIAGNOSTICS inserted = ROW_COUNT; IF inserted <> 1 THEN RAISE EXCEPTION 'LEVEL_COUNT_NOT_ONE'; END IF;",
    ' INSERT INTO novelight_formal_private.scout_point_usage_wallets',
    ' (user_id,available_points,exchange_eligible_points,reserved_points,held_points,revision)',
    ' VALUES (' + u + ',0,0,0,0,0);',
    " GET DIAGNOSTICS inserted = ROW_COUNT; IF inserted <> 1 THEN RAISE EXCEPTION 'WALLET_COUNT_NOT_ONE'; END IF;",
    'END',
    '$one_reader$;',
    'COMMIT;'
  ].join('\n');
}
export function buildReadbackSql(id) {
  if (!UUID.test(id || '')) fail();
  const u = "'" + id + "'::uuid";
  return [
    'select json_build_object(',
    " 'levels', (select count(*) from novelight_formal_private.scout_level_state where user_id=" +
      u +
      ' and current_level=1 and highest_level=1 and level_progress_xp=0 and revision=0),',
    " 'wallets', (select count(*) from novelight_formal_private.scout_point_usage_wallets where user_id=" +
      u +
      ' and available_points=0 and exchange_eligible_points=0 and reserved_points=0 and held_points=0 and revision=0),',
    " 'points', (select count(*) from public.scout_point_ledger where user_id=" +
      u +
      '),',
    " 'xp', (select count(*) from public.scout_xp_ledger where user_id=" +
      u +
      '),',
    " 'anchorOk', (select count(*) from novelight_formal_private.scout_level_state l join auth.users a on a.id=l.user_id where a.id=" +
      u +
      ' and l.review_anchor_at=a.created_at)',
    ')'
  ].join('\n');
}
function envGate(env) {
  if (
    env.NOVELIGHT_ONE_READER_ADMITTED !== '1' ||
    env.STAGING_SUPABASE_URL !== URL ||
    env.STAGING_PROJECT_REF !== REF ||
    env.STAGING_TEST_REFERENCE !== TEST_AT ||
    env.GITHUB_RUN_ATTEMPT !== '1' ||
    !SHA.test(env.APPROVED_MAIN_SHA || '') ||
    !/^[1-9]\d*$/.test(env.STAGING_REQUEST_COMMENT_ID || '') ||
    !env.STAGING_DATABASE_URL_FILE ||
    !env.STAGING_SUPABASE_SECRET_KEY?.startsWith('sb_secret_') ||
    !env.STAGING_SUPABASE_PUBLISHABLE_KEY?.startsWith('sb_publishable_')
  )
    fail();
}
function command(exe, args, options = {}) {
  const r = spawnSync(exe, args, {
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
    ...options
  });
  if (r.error || r.status !== 0) fail(); // never print credentials/JWT/SQL errors
  return r.stdout.trim();
}
const dbSql = (url, sql) =>
  command('psql', [url, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], {
    input: sql,
    env: { ...process.env, PGSSLMODE: 'require', PGCONNECT_TIMEOUT: '8' }
  });
async function live(env = process.env) {
  envGate(env);
  if (
    command('git', ['rev-parse', 'HEAD']) !== env.APPROVED_MAIN_SHA ||
    command('gh', [
      'api',
      'repos/bingohooah888-ai/novelrise/git/ref/heads/main',
      '--jq',
      '.object.sha'
    ]) !== env.APPROVED_MAIN_SHA
  )
    fail();
  const db = readFileSync(env.STAGING_DATABASE_URL_FILE, 'utf8').trim();
  verifyStagingMigrationTarget({
    STAGING_SUPABASE_URL: URL,
    STAGING_DATABASE_URL: db,
    PGSSLMODE: 'require'
  });
  const { createClient } = await import('@supabase/supabase-js');
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(URL, env.STAGING_SUPABASE_SECRET_KEY, options);
  const client = createClient(
    URL,
    env.STAGING_SUPABASE_PUBLISHABLE_KEY,
    options
  );
  const email = 'formal-reader-one-' + randomUUID() + '@example.invalid';
  const password = 'Test1!' + randomBytes(25).toString('base64url');
  // At most one Auth creation; no automatic retries or deletions.
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { proof_scope: 'formal-new-reader-one-staging-proof' }
  });
  const id = created?.data?.user?.id;
  if (created?.error || !UUID.test(id || '')) fail();
  console.log('STAGING_SYNTHETIC_READER_UUID=' + id);
  const signIn = await client.auth.signInWithPassword({ email, password });
  const token = signIn?.data?.session?.access_token;
  if (signIn?.error || !token || signIn.data.session.user?.id !== id) fail();
  const checked = await client.auth.getUser(token);
  if (checked?.error || checked.data?.user?.id !== id) fail();
  console.log('STAGING_AUTH_JWT_IDENTITY_CONFIRMED');
  // psql reads stdin; BEGIN/DO/COMMIT run in one backend connection.
  dbSql(db, buildNewReaderSql(id));
  const rows = dbSql(db, buildReadbackSql(id)).split('\n').filter(Boolean);
  if (rows.length !== 1) fail();
  const r = decode(rows[0]);
  if (
    r.levels !== 1 ||
    r.wallets !== 1 ||
    r.points !== 0 ||
    r.xp !== 0 ||
    r.anchorOk !== 1
  )
    fail();
  console.log('STAGING_READER_LEVEL1_WALLET0_CONFIRMED');
  console.log('SYNTHETIC_READER_PRESERVED_NO_AUTO_CLEANUP');
}
async function main() {
  const mode = process.argv[2];
  if (mode === 'validate' && process.argv.length === 6) {
    const [event, main, ledger] = process.argv
      .slice(3)
      .map((f) => decode(readFileSync(f, 'utf8')));
    console.log(
      JSON.stringify(
        validateOneReaderApproval({ event, main, ledger, env: process.env })
      )
    );
  } else if (mode === 'run' && process.argv.length === 3) {
    await live();
  } else fail();
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(() => {
    console.error('STAGING_NEW_READER_PROOF_STOPPED_NO_RETRY');
    process.exitCode = 1;
  });
}
