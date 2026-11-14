import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const requestWorkflow = await readFile(
  '.github/workflows/supabase-staging-sync-request.yml',
  'utf8'
);
const syncWorkflow = await readFile(
  '.github/workflows/supabase-staging-sync.yml',
  'utf8'
);

const readerStart = requestWorkflow.indexOf(
  '\n  # Separate OWNER-only proof for one new synthetic Staging reader.'
);
assert.notEqual(readerStart, -1, 'missing isolated new-reader jobs');
const migrationRequestWorkflow = requestWorkflow.slice(0, readerStart);
const newReaderWorkflow = requestWorkflow.slice(readerStart);

function requirePatterns(source, patterns) {
  for (const pattern of patterns) {
    assert.match(source, pattern);
  }
}

test('Staging request bridge is owner-only', () => {
  requirePatterns(migrationRequestWorkflow, [
    /issue_comment:/,
    /github\.event\.issue\.number == 294/,
    /github\.event\.issue\.title == '\[Staging Control\] Supabase migration sync'/,
    /github\.event\.issue\.user\.login == 'bingohooah888-ai'/,
    /github\.event\.comment\.user\.login == 'bingohooah888-ai'/,
    /github\.event\.comment\.author_association == 'OWNER'/,
    /NOVELIGHT_STAGING_APPROVE /
  ]);
});

test('Staging request validates exact mutation inputs', () => {
  requirePatterns(migrationRequestWorkflow, [
    /test\("\^\[0-9a-f\]\{40\}\$"\)/,
    /test\("\^\[0-9\]\{14\}\$"\)/,
    /\.scope == "migration-sync"/,
    /\.confirmation == "STAGING APPROVED"/,
    /\["confirmation", "mainSha", "migration", "scope"\]/,
    /main changed before the request was claimed/
  ]);
});

test('Staging request has a one-time durable ledger', () => {
  requirePatterns(migrationRequestWorkflow, [
    /NOVELIGHT_STAGING_MIGRATION_SYNC_CLAIMED /,
    /NOVELIGHT_STAGING_MIGRATION_SYNC_CONSUMED /,
    /requestCommentId/,
    /already claimed or consumed/,
    /if: always\(\)/
  ]);
});

test('Staging request delegates to fail-closed sync', () => {
  requirePatterns(migrationRequestWorkflow, [
    /uses: \.\/\.github\/workflows\/supabase-staging-sync\.yml/,
    /revision: \$\{\{ needs\.request\.outputs\.main_sha \}\}/,
    /migrations: \$\{\{ needs\.request\.outputs\.migration \}\}/,
    /confirmation: \$\{\{ needs\.request\.outputs\.confirmation \}\}/,
    /secrets: inherit/
  ]);
  requirePatterns(syncWorkflow, [
    /workflow_call:/,
    /environment: staging/,
    /verify-staging-migrations\.sh pending/,
    /db push --db-url "\$STAGING_DATABASE_URL" --yes/,
    /verify-staging-migrations\.sh parity/
  ]);
  assert.doesNotMatch(syncWorkflow, /workflow_dispatch:/);
});

test('Staging request bridge excludes DB credentials', () => {
  const forbidden = [
    /STAGING_DATABASE_URL/,
    /PRODUCTION_DB_PASSWORD/,
    /SUPABASE_ACCESS_TOKEN/,
    /production-approval/,
    /environment: production/,
    /rollback/,
    /db push/
  ];
  for (const pattern of forbidden) {
    assert.doesNotMatch(migrationRequestWorkflow, pattern);
  }
});

test('One-reader proof isolates Staging credentials and atomic writes', () => {
  requirePatterns(newReaderWorkflow, [
    /^  admit_one_new_reader:/m,
    /^  stage_one_new_reader:/m,
    /^  record_one_new_reader:/m,
    /NOVELIGHT_STAGING_NEW_READER_ONE_APPROVE /,
    /environment: staging/,
    /STAGING_DATABASE_URL_SOURCE: \$\{\{ secrets\.STAGING_DATABASE_URL \}\}/,
    /STAGING_SUPABASE_SECRET_KEY: \$\{\{ secrets\.STAGING_SUPABASE_SECRET_KEY \}\}/,
    /STAGING_SUPABASE_PUBLISHABLE_KEY: \$\{\{ secrets\.STAGING_SUPABASE_PUBLISHABLE_KEY \}\}/,
    /app_metadata:\{internal_e2e:true\}/,
    /SET TRANSACTION ISOLATION LEVEL SERIALIZABLE/
  ]);
  const stage = newReaderWorkflow.slice(
    newReaderWorkflow.indexOf('\n  stage_one_new_reader:'),
    newReaderWorkflow.indexOf('\n  record_one_new_reader:')
  );
  const jobEnv = stage.slice(
    stage.indexOf('\n    env:'),
    stage.indexOf('\n    steps:')
  );
  assert.doesNotMatch(
    jobEnv,
    /STAGING_DATABASE_URL_SOURCE:|STAGING_SUPABASE_SECRET_KEY:|STAGING_SUPABASE_PUBLISHABLE_KEY:/
  );
  const insertPattern = /INSERT INTO novelight_formal_private\./g;
  assert.equal(newReaderWorkflow.match(insertPattern)?.length, 2);
  for (const forbidden of [
    /PRODUCTION_DB_PASSWORD/,
    /SUPABASE_ACCESS_TOKEN/,
    /environment: production/,
    /workflow_dispatch:/,
    /db push/
  ]) {
    assert.doesNotMatch(newReaderWorkflow, forbidden);
  }
});

const oneReaderRuntime = [
  ...newReaderWorkflow.matchAll(
    /^ {10}node --input-type=module <<'JS'\n([\s\S]*?)^ {10}JS$/gm
  )
].find((m) => m[1].includes('STAGING_ONE_READER_FAILURE_STAGE'));
assert.ok(oneReaderRuntime, 'missing one-reader runtime heredoc');
const oneReaderSource = oneReaderRuntime[1]
  .split('\n')
  .map((line) => line.replace(/^ {10}/, ''))
  .join('\n')
  .replace(/^import [^\n]+\n/gm, '');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const runOneReaderCode = new AsyncFunction(
  'readFileSync',
  'randomBytes',
  'randomUUID',
  'spawnSync',
  'createClient',
  'verifyStagingMigrationTarget',
  'process',
  'console',
  oneReaderSource
);

async function simulateOneReader(options = {}) {
  const sha = 'a'.repeat(40);
  const id = '11111111-2222-3333-4444-555555555555';
  const db = 'postgresql://postgres.wmlzjgvxgoyrovdhbqbg:fake%25offline@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres';
  const state = {
    authCalls: 0,
    signIns: 0,
    jwtChecks: 0,
    catalog: 0,
    writes: 0,
    reads: 0
  };
  const output = [];
  const errors = [];
  const env = {
    GITHUB_RUN_ATTEMPT: '1',
    NOVELIGHT_ONE_READER_ADMITTED: '1',
    STAGING_SUPABASE_URL: 'https://wmlzjgvxgoyrovdhbqbg.supabase.co',
    STAGING_TEST_REFERENCE: '2026-11-10T00:00:00.000Z',
    APPROVED_MAIN_SHA: sha,
    STAGING_REQUEST_COMMENT_ID: '123456',
    STAGING_SUPABASE_SECRET_KEY: 'sb_secret_offline_only',
    STAGING_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_offline_only',
    STAGING_DATABASE_URL_FILE: '/tmp/offline-staging-url',
    PATH: '/usr/bin',
    HOME: '/tmp'
  };
  const fakeProcess = { env, exitCode: 0 };
  const fakeSpawn = (exe, args, opts) => {
    if (exe === 'git' || exe === 'gh') {
      return { status: 0, stdout: sha + '\n' };
    }
    assert.equal(exe, 'psql');
    assert.deepEqual(args, ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', db]);
    assert.equal(opts.env.PGSSLMODE, 'require');
    assert.equal(opts.env.PGUSER, undefined);
    assert.equal(opts.env.PGPASSWORD, undefined);
    assert.equal(opts.env.STAGING_SUPABASE_SECRET_KEY, undefined);
    const sql = opts.input;
    if (sql.includes('pg_catalog.pg_attribute')) {
      state.catalog++;
      assert.equal(state.authCalls, 0, 'catalog must run before Auth creation');
      assert.match(sql, /auth\.users/);
      assert.match(sql, /scout_level_state/);
      assert.match(sql, /scout_point_usage_wallets/);
      assert.match(sql, /has_table_privilege/);
      return { status: 0, stdout: options.missingSchema ? '16\n' : '17\n' };
    }
    if (sql.includes('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE')) {
      state.writes++;
      assert.equal(state.authCalls, 1);
      assert.match(sql, /BEGIN;/);
      assert.match(sql, /COMMIT;/);
      assert.match(sql, /FOR UPDATE/);
      assert.equal(
        (sql.match(/INSERT INTO novelight_formal_private\./g) || []).length,
        2
      );
      assert.match(sql, /raw_user_meta_data->>'proof_scope'/);
      return {
        status: options.writeFailure ? 1 : 0,
        stdout: '',
        stderr: 'never log error detail'
      };
    }
    if (sql.includes('SELECT json_build_object(')) {
      state.reads++;
      return {
        status: 0,
        stdout:
          JSON.stringify({
            level: 1,
            wallet: options.readbackMismatch ? 0 : 1,
            point: 0,
            xp: 0,
            anchor: 1
          }) + '\n'
      };
    }
    throw Error('unexpected offline SQL');
  };
  const createClient = (url, key) => {
    assert.equal(url, env.STAGING_SUPABASE_URL);
    if (key === env.STAGING_SUPABASE_SECRET_KEY) {
      return {
        auth: {
          admin: {
            createUser: async ({ email, email_confirm, app_metadata }) => {
              state.authCalls++;
              assert.match(email, /@example\.invalid$/);
              assert.equal(email_confirm, true);
              assert.equal(app_metadata.internal_e2e, true);
              if (options.createFailure) {
                return { error: { message: 'private provider message' } };
              }
              return { data: { user: { id } } };
            }
          }
        }
      };
    }
    assert.equal(key, env.STAGING_SUPABASE_PUBLISHABLE_KEY);
    return {
      auth: {
        signInWithPassword: async () => {
          state.signIns++;
          if (options.jwtFailure) {
            return { error: { message: 'private auth detail' } };
          }
          return {
            data: { session: { access_token: 'offline.jwt', user: { id } } }
          };
        },
        getUser: async () => {
          state.jwtChecks++;
          return { data: { user: { id } } };
        }
      }
    };
  };
  const fakeRead = (path) => {
    assert.equal(path, env.STAGING_DATABASE_URL_FILE);
    if (options.fileMissing) throw Error('private file detail');
    return db + '\n';
  };
  const fakeVerify = (target) => {
    assert.equal(target.STAGING_SUPABASE_URL, env.STAGING_SUPABASE_URL);
    assert.equal(target.STAGING_DATABASE_URL, db);
    assert.equal(target.PGSSLMODE, 'require');
    if (options.invalidTarget) throw Error('private target detail');
  };
  await runOneReaderCode(
    fakeRead,
    () => ({ toString: () => 'offline-password' }),
    () => id,
    fakeSpawn,
    createClient,
    fakeVerify,
    fakeProcess,
    {
      log: (message) => output.push(message),
      error: (message) => errors.push(message)
    }
  );
  assert.doesNotMatch(
    JSON.stringify({ output, errors }),
    /sb_secret_|sb_publishable_|fake%25offline|private .* detail/
  );
  return { state, output, errors, exitCode: fakeProcess.exitCode };
}

test('offline full one-reader path', async () => {
  const r = await simulateOneReader();
  assert.equal(r.exitCode, 0);
  assert.deepEqual(r.state, {
    authCalls: 1,
    signIns: 1,
    jwtChecks: 1,
    catalog: 1,
    writes: 1,
    reads: 1
  });
  assert.ok(r.output.some((x) => x.startsWith('STAGING_ONE_READER_UUID=')));
  assert.ok(r.output.includes('STAGING_ONE_READER_JWT_MATCH=1'));
  assert.ok(
    r.output.includes('STAGING_ONE_READER_LEVEL1_WALLET0_CONFIRMED=1')
  );
  assert.equal(r.errors.length, 0);
});

test('offline catalog failure prevents Auth and DB writes', async () => {
  const r = await simulateOneReader({ missingSchema: true });
  assert.equal(r.exitCode, 1);
  assert.equal(r.state.authCalls, 0);
  assert.equal(r.state.writes, 0);
  assert.ok(
    r.errors.includes(
      'STAGING_ONE_READER_FAILURE_STAGE=staging_database_catalog_preflight'
    )
  );
});

test('offline missing DB file or target prevents Auth creation', async () => {
  for (const [option, stage] of [
    ['fileMissing', 'staging_database_file'],
    ['invalidTarget', 'staging_database_target']
  ]) {
    const r = await simulateOneReader({ [option]: true });
    assert.equal(r.exitCode, 1);
    assert.equal(r.state.authCalls, 0);
    assert.ok(r.errors.includes('STAGING_ONE_READER_FAILURE_STAGE=' + stage));
  }
});

test('offline Auth and JWT failures do not write to DB', async () => {
  for (const [option, stage] of [
    ['createFailure', 'auth_create_user'],
    ['jwtFailure', 'jwt_sign_in']
  ]) {
    const r = await simulateOneReader({ [option]: true });
    assert.equal(r.exitCode, 1);
    assert.equal(r.state.authCalls, 1);
    assert.equal(r.state.writes, 0);
    assert.ok(r.errors.includes('STAGING_ONE_READER_FAILURE_STAGE=' + stage));
  }
});

test('offline DB failures stop without retries or detail leakage', async () => {
  for (const [option, stage, reads] of [
    ['writeFailure', 'database_level_wallet_write', 0],
    ['readbackMismatch', 'database_level_wallet_readback', 1]
  ]) {
    const r = await simulateOneReader({ [option]: true });
    assert.equal(r.exitCode, 1);
    assert.equal(r.state.authCalls, 1);
    assert.equal(r.state.writes, 1);
    assert.equal(r.state.reads, reads);
    assert.ok(r.errors.includes('STAGING_ONE_READER_FAILURE_STAGE=' + stage));
    assert.ok(r.errors.includes('STAGING_ONE_READER_STOPPED_NO_RETRY'));
  }
});

// TEMP_PRETTIER_OUTPUT_DO_NOT_KEEP

test('format reporter for existing changed test file', async () => {
  const prettier = await import('prettier');
  const file = 'tests/staging-migration-sync-request.test.mjs';
  const current = await readFile(file, 'utf8');
  const original = current.split('\n// TEMP_PRETTIER_OUTPUT_DO_NOT_KEEP\n')[0];
  const config = (await prettier.resolveConfig(file)) || {};
  const formatted = await prettier.format(original, { ...config, filepath: file });
  console.log('NOVELIGHT_PRETTIER_FORMATTED_JSON=' + JSON.stringify(formatted));
});
