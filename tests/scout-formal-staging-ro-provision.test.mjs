import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveFormalReaderDatabaseUrl,
  makeScramVerifier,
  provisionFormalStagingReader,
  verifyFormalReaderProvisionContext
} from '../scripts/scout-formal-staging-ro-provision.mjs';

const REF = 'wmlzjgvxgoyrovdhbqbg';
const BRANCH = 'feature/scout-formal-last-mile-integrity-off-20261115';
const adminUrl =
  'postgresql://postgres:synthetic-only@db.' +
  REF +
  '.supabase.co:5432/postgres';
const stage = {
  GITHUB_ACTIONS: 'true',
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_REPOSITORY: 'bingohooah888-ai/novelrise',
  GITHUB_REF: 'refs/heads/main',
  GITHUB_WORKFLOW_REF:
    'bingohooah888-ai/novelrise/.github/workflows/' +
    'scout-formal-staging-ro-provision.yml@refs/heads/main',
  GITHUB_ACTOR: 'bingohooah888-ai',
  GITHUB_TRIGGERING_ACTOR: 'bingohooah888-ai',
  GITHUB_RUN_ATTEMPT: '1',
  GITHUB_SHA: 'a'.repeat(40),
  EXPECTED_MAIN_SHA: 'a'.repeat(40),
  FORMAL_STAGING_SCOPE: 'scout-formal-reader-credential-staging-v1',
  FORMAL_STAGING_CONFIRMATION: 'STAGING FORMAL RO APPROVED',
  FORMAL_STAGING_REF: REF,
  FORMAL_STAGING_PREVIEW_BRANCH: BRANCH,
  STAGING_SUPABASE_URL: 'https://' + REF + '.supabase.co',
  STAGING_DATABASE_URL: adminUrl,
  VERCEL_API_TOKEN: 'synthetic-token-only'
};

test('OWNER-only trusted-main Staging context is required', () => {
  assert.equal(verifyFormalReaderProvisionContext(stage), true);
  for (const [field, invalid] of [
    ['GITHUB_REF', 'refs/heads/feature/test'],
    ['GITHUB_ACTOR', 'other'],
    ['GITHUB_RUN_ATTEMPT', '2'],
    ['EXPECTED_MAIN_SHA', 'b'.repeat(40)],
    ['FORMAL_STAGING_SCOPE', 'migration-sync'],
    ['FORMAL_STAGING_REF', 'fiepaguycecrredwrcwx'],
    ['FORMAL_STAGING_PREVIEW_BRANCH', 'main'],
    ['GITHUB_WORKFLOW_REF', 'a different workflow'],
    ['STAGING_SUPABASE_URL', 'https://fiepaguycecrredwrcwx.supabase.co']
  ]) {
    assert.throws(
      () => verifyFormalReaderProvisionContext({ ...stage, [field]: invalid }),
      /UNTRUSTED_APPROVAL_CONTEXT/u,
      field
    );
  }
  assert.throws(
    () => verifyFormalReaderProvisionContext({ ...stage, VERCEL_API_TOKEN: '' }),
    /EXISTING_STAGING_SECRETS_REQUIRED/u
  );
});

test('formal reader credentials use the approved Staging host only', () => {
  const password = 'p'.repeat(64);
  const direct = new URL(deriveFormalReaderDatabaseUrl(adminUrl, password));
  assert.equal(direct.username, 'novelight_formal_reader_ro');
  assert.equal(direct.hostname, 'db.' + REF + '.supabase.co');
  assert.equal(direct.password, password);
  const pooler = new URL(
    deriveFormalReaderDatabaseUrl(
      'postgresql://postgres.' +
        REF +
        ':fake@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres',
      password
    )
  );
  assert.equal(pooler.username, 'novelight_formal_reader_ro.' + REF);
  for (const bad of [
    'postgresql://postgres:fake@db.fiepaguycecrredwrcwx.supabase.co:5432/postgres',
    'postgresql://postgres:fake@db.' + REF + '.supabase.co:6543/postgres',
    'postgresql://postgres:fake@db.' +
      REF +
      '.supabase.co:5432/postgres?sslmode=disable'
  ]) {
    assert.throws(
      () => deriveFormalReaderDatabaseUrl(bad, password),
      /DATABASE_ROUTE_INVALID/u
    );
  }
});

test('SCRAM verifier excludes the generated plaintext password', () => {
  const password = 'p'.repeat(64);
  const verifier = makeScramVerifier(password, Buffer.alloc(16, 7));
  assert.match(
    verifier,
    /^SCRAM-SHA-256\$4096:[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/u
  );
  assert.equal(verifier.includes(password), false);
  assert.throws(
    () => makeScramVerifier('too-short', Buffer.alloc(16)),
    /SCRAM_INPUT_INVALID/u
  );
});

test('missing Staging credentials block all I/O', async () => {
  let invoked = false;
  await assert.rejects(
    provisionFormalStagingReader({
      env: { ...stage, STAGING_DATABASE_URL: '' },
      fetchImpl: async () => {
        invoked = true;
        throw new Error('network should be unreachable');
      },
      ClientImpl: class {
        constructor() {
          invoked = true;
        }
      }
    }),
    /EXISTING_STAGING_SECRETS_REQUIRED/u
  );
  assert.equal(invoked, false);
});
