import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

const PROJECT_REF = 'wmlzjgvxgoyrovdhbqbg';
const PRODUCTION_REF = 'fiepaguycecrredwrcwx';
const EXPECTED_SCOPE = 'formal-30day-review-backup-restore-readonly-v1';
const EXPECTED_CONFIRMATION = 'STAGING FORMAL 30DAY BACKUP RESTORE READONLY APPROVED';

export function parseStagingConnection(raw) {
  if (typeof raw !== 'string' || raw.length < 20) throw Error('UNAVAILABLE_CONNECTION');
  let url;
  try { url = new URL(raw); } catch { throw Error('INVALID_CONNECTION'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
      url.pathname !== '/postgres' || url.search || url.hash ||
      !url.password || url.hostname.includes(PRODUCTION_REF)) {
    throw Error('INVALID_STAGING_TARGET');
  }
  const username = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  if (!password || !username) throw Error('INVALID_CONNECTION_CREDENTIALS');
  const isDirect = url.hostname === `db.${PROJECT_REF}.supabase.co` &&
    username === 'postgres' && (url.port === '5432' || url.port === '');
  const isPooler = /^aws-[01]-ap-northeast-1\.pooler\.supabase\.com$/u.test(url.hostname) &&
    username === `postgres.${PROJECT_REF}` && url.port === '5432';
  if (!isDirect && !isPooler) throw Error('STAGING_TARGET_MISMATCH');
  return Object.freeze({
    PGHOST: url.hostname, PGPORT: url.port || '5432', PGUSER: username,
    PGPASSWORD: password, PGDATABASE: 'postgres', PGSSLMODE: 'require',
    PGOPTIONS: '-c default_transaction_read_only=on', PGCONNECT_TIMEOUT: '12'
  });
}

export function fingerprintSql() {
  const digest = (table, total = null) => {
    const d = `coalesce(md5(string_agg(md5(to_jsonb(t)::text), '' ORDER BY md5(to_jsonb(t)::text))), md5(''))`;
    const columns = [`'rows',count(*)::bigint`, `'digest',${d}`];
    if (total) columns.push(`'total',coalesce(sum(${total})::bigint,0)`);
    return `(SELECT json_build_object(${columns.join(',')}) FROM ${table} AS t)`;
  };
  return `SELECT json_build_object(
    'auth', ${digest('auth.users')},
    'level', ${digest('novelight_formal_private.scout_level_state')},
    'review', ${digest('novelight_formal_private.scout_review_claim')},
    'wallet', ${digest('novelight_formal_private.scout_point_usage_wallets')},
    'xp', ${digest('public.scout_xp_ledger', 'xp_value')},
    'point', ${digest('public.scout_point_ledger', 'point_value')}
  )::text;`;
}

function run(executable, args, { env = process.env, timeout = 600000, capture = false } = {}) {
  const r = spawnSync(executable, args, {
    env, timeout, maxBuffer: 1024 * 1024,
    encoding: 'utf8', stdio: ['ignore', capture ? 'pipe' : 'ignore', 'ignore'],
    windowsHide: true
  });
  if (r.status !== 0 || r.error || r.signal) throw Error('ISOLATED_STEP_FAILED');
  return capture ? r.stdout.trim() : '';
}

function runRemoteImage(image, pg, args, workdir, capture = false) {
  return run('docker', [
    'run', '--rm', '--network', 'host',
    '--mount', `type=bind,source=${workdir},target=/backup`,
    ...Object.keys(pg).flatMap(key => ['--env', key]),
    image, ...args
  ], { env: { ...process.env, ...pg }, capture });
}

function fingerprintImage(image, pg, dir) {
  const result = runRemoteImage(image, pg,
    ['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', fingerprintSql()], dir, true);
  return JSON.parse(result);
}

function fingerprintRestore(name) {
  const raw = run('docker', [
    'exec', name, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
    '-U', 'postgres', '-d', 'restored', '-c', fingerprintSql()
  ], { capture: true });
  return JSON.parse(raw);
}

function checkRuntime(env) {
  if (env.GITHUB_REPOSITORY !== 'bingohooah888-ai/novelrise' ||
      env.GITHUB_REF !== 'refs/heads/feature/reader-reward-gate01-20261104' ||
      env.GITHUB_ACTOR !== 'bingohooah888-ai' ||
      env.GITHUB_TRIGGERING_ACTOR !== 'bingohooah888-ai' ||
      env.GITHUB_RUN_ATTEMPT !== '1' ||
      env.REQUESTED_SCOPE !== EXPECTED_SCOPE ||
      env.REQUESTED_CONFIRMATION !== EXPECTED_CONFIRMATION ||
      !/^[a-f0-9]{40}$/u.test(env.EXPECTED_MAIN_SHA || '') ||
      !/^[a-f0-9]{40}$/u.test(env.EXPECTED_CANDIDATE_SHA || '') ||
      env.GITHUB_SHA !== env.EXPECTED_CANDIDATE_SHA ||
      env.STAGING_SUPABASE_URL !== `https://${PROJECT_REF}.supabase.co`) {
    throw Error('AUTHORIZATION_OR_TARGET_NOT_VERIFIED');
  }
}

export function performReadOnlyProof(env = process.env) {
  checkRuntime(env);
  const pg = parseStagingConnection(env.STAGING_DATABASE_URL);
  const folder = mkdtempSync(join(tmpdir(), 'novelight-30day-backup-'));
  const archive = join(folder, 'staging-full.dump');
  const name = `nl-30day-restore-${randomUUID().slice(0, 12)}`;
  const image = 'postgres:17';
  let started = false;
  try {
    const before = fingerprintImage(image, pg, folder);
    runRemoteImage(image, pg, [
      'pg_dump', '--format=custom', '--no-owner', '--no-acl',
      '--file=/backup/staging-full.dump'
    ], folder);
    if (statSync(archive).size < 1024) throw Error('BACKUP_NOT_CREATED');
    run('docker', ['run', '--rm', '--mount', `type=bind,source=${folder},target=/backup,readonly`,
      image, 'pg_restore', '--list', '/backup/staging-full.dump']);
    run('docker', ['run', '--rm', '-d', '--network', 'none', '--name', name,
      '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', image]);
    started = true;
    let ready = false;
    for (let i = 0; i < 35; i += 1) {
      try {
        run('docker', ['exec', name, 'pg_isready', '-U', 'postgres', '-d', 'postgres'],
          { timeout: 10000 });
        ready = true;
        break;
      } catch {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 900);
      }
    }
    if (!ready) throw Error('RESTORE_TARGET_UNAVAILABLE');
    run('docker', ['exec', name, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres',
      '-d', 'postgres', '-c', 'CREATE DATABASE restored;']);
    run('docker', ['exec', name, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres',
      '-d', 'restored', '-c', 'DROP SCHEMA IF EXISTS public CASCADE;']);
    run('docker', ['cp', archive, `${name}:/tmp/staging-full.dump`]);
    run('docker', ['exec', name, 'pg_restore', '--exit-on-error', '--no-owner',
      '--no-acl', '-U', 'postgres', '-d', 'restored', '/tmp/staging-full.dump'],
      { timeout: 900000 });
    const restored = fingerprintRestore(name);
    const after = fingerprintImage(image, pg, folder);
    if (JSON.stringify(before) !== JSON.stringify(restored) ||
        JSON.stringify(before) !== JSON.stringify(after)) {
      throw Error('BACKUP_RESTORE_OR_STAGING_DRIFT');
    }
    console.log('FORMAL_30DAY_STAGING_FULL_BACKUP_INDEPENDENT_RESTORE_PASS');
    console.log('FORMAL_30DAY_NO_STAGING_WRITE_NO_REVIEW_FUNCTION_CALL');
  } finally {
    if (started) {
      try { run('docker', ['rm', '-f', name], { timeout: 40000 }); } catch {}
    }
    rmSync(folder, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // The CLI runs only when explicitly invoked; imports are safe for unit tests.
  try { performReadOnlyProof(); }
  catch { console.error('FORMAL_30DAY_BACKUP_RESTORE_HOLD_NO_STAGING_WRITES'); process.exitCode = 1; }
}
