import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';
import {
  deriveFormalReaderDatabaseUrl,
  formatFormalRoProvisionFailure,
  makeScramVerifier,
  provisionFormalStagingReader,
  verifyFormalReaderProvisionContext,
  verifyFormalReaderTls
} from '../scripts/scout-formal-staging-ro-provision.mjs';

const REF = 'wmlzjgvxgoyrovdhbqbg';
const BRANCH = 'feature/scout-formal-qualified-earnings-offline-20261116';
const admin = new URL(
  'postgresql://postgres:synthetic@localhost:5432/postgres'
);
admin.hostname = 'db.' + REF + '.supabase.co';
const ADMIN_DSN = admin.toString();

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
  STAGING_DATABASE_URL: ADMIN_DSN,
  VERCEL_API_TOKEN: 'synthetic-token'
};

const verify = (change) =>
  verifyFormalReaderProvisionContext({ ...stage, ...change });

test('only the OWNER trusted-main context is allowed', () => {
  assert.equal(verify({}), true);
  for (const [key, value] of [
    ['GITHUB_REF', 'refs/heads/not-main'],
    ['GITHUB_ACTOR', 'someone-else'],
    ['GITHUB_RUN_ATTEMPT', '2'],
    ['EXPECTED_MAIN_SHA', 'b'.repeat(40)],
    ['FORMAL_STAGING_SCOPE', 'migration-sync'],
    ['FORMAL_STAGING_REF', 'fiepaguycecrredwrcwx'],
    ['FORMAL_STAGING_PREVIEW_BRANCH', 'main'],
    ['GITHUB_WORKFLOW_REF', 'different-workflow'],
    ['STAGING_SUPABASE_URL', 'https://other.supabase.co']
  ]) {
    assert.throws(
      () => verify({ [key]: value }),
      /UNTRUSTED_APPROVAL_CONTEXT/u
    );
  }
  assert.throws(
    () => verify({ VERCEL_API_TOKEN: '' }),
    /EXISTING_STAGING_SECRETS_REQUIRED/u
  );
});

test('reader URL is limited to the dedicated Staging database', () => {
  const password = 'p'.repeat(64);
  const dsn = deriveFormalReaderDatabaseUrl(ADMIN_DSN, password);
  const reader = new URL(dsn);
  assert.equal(reader.username, 'novelight_formal_reader_ro');
  assert.equal(reader.hostname, 'db.' + REF + '.supabase.co');

  const pooler = new URL(ADMIN_DSN);
  pooler.hostname = 'aws-0-ap-northeast-1.pooler.supabase.com';
  pooler.username = 'postgres.' + REF;
  const poolerDsn = deriveFormalReaderDatabaseUrl(pooler.toString(), password);
  assert.equal(
    new URL(poolerDsn).username,
    'novelight_formal_reader_ro.' + REF
  );

  const wrong = new URL(ADMIN_DSN);
  wrong.hostname = 'db.fiepaguycecrredwrcwx.supabase.co';
  assert.throws(
    () => deriveFormalReaderDatabaseUrl(wrong.toString(), password),
    /DATABASE_ROUTE_INVALID/u
  );
  wrong.hostname = 'db.' + REF + '.supabase.co';
  wrong.port = '6543';
  assert.throws(
    () => deriveFormalReaderDatabaseUrl(wrong.toString(), password),
    /DATABASE_ROUTE_INVALID/u
  );
});

test('SCRAM verifier never contains its plaintext password', () => {
  const password = 'p'.repeat(64);
  const verifier = makeScramVerifier(password, Buffer.alloc(16, 7));
  assert.match(verifier, /^SCRAM-SHA-256\$4096:/u);
  assert.equal(verifier.includes(password), false);
  assert.throws(
    () => makeScramVerifier('weak', Buffer.alloc(16)),
    /SCRAM_INPUT_INVALID/u
  );
});

test('missing Secret fails before external access', async () => {
  let touchedNetwork = false;
  await assert.rejects(
    provisionFormalStagingReader({
      env: { ...stage, STAGING_DATABASE_URL: '' },
      fetchImpl: async () => {
        touchedNetwork = true;
        throw new Error('must never call external fetch');
      }
    }),
    /EXISTING_STAGING_SECRETS_REQUIRED/u
  );
  assert.equal(touchedNetwork, false);
});

test('OWNER-only Staging RO workflow pins PR #2935 and stays manual', () => {
  const workflow = readFileSync(
    new URL(
      '../.github/workflows/scout-formal-staging-ro-provision.yml',
      import.meta.url
    ),
    'utf8'
  );
  assert.match(workflow, /^on:\n  workflow_dispatch:/mu);
  assert.doesNotMatch(workflow, /^\s+(push|pull_request):/mu);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/u);
  assert.match(workflow, /inputs\.main_sha == github\.sha/u);
  assert.match(workflow, /environment: staging/u);
  assert.ok(workflow.includes("inputs.preview_branch == '" + BRANCH + "'"));
  assert.ok(workflow.includes("inputs.staging_ref == '" + REF + "'"));
  assert.doesNotMatch(
    workflow,
    /feature\/scout-formal-last-mile-integrity-off-20261115/u
  );
  assert.throws(
    () =>
      verify({
        FORMAL_STAGING_PREVIEW_BRANCH:
          'feature/scout-formal-last-mile-integrity-off-20261115'
      }),
    /UNTRUSTED_APPROVAL_CONTEXT/u
  );
  assert.throws(
    () => verify({ GITHUB_EVENT_NAME: 'pull_request' }),
    /UNTRUSTED_APPROVAL_CONTEXT/u
  );
  assert.throws(
    () => verify({ GITHUB_EVENT_NAME: 'push' }),
    /UNTRUSTED_APPROVAL_CONTEXT/u
  );
});

test('failure messages allow only fixed safe codes', () => {
  const secret = 'private-password';
  const result = formatFormalRoProvisionFailure(
    { safeCode: secret },
    'STAGING_ADMIN_CONNECT'
  );
  assert.equal(
    result,
    'FORMAL_RO_STAGING_PROVISION_STOPPED:STAGING_ADMIN_CONNECT:UNCLASSIFIED_FAILURE'
  );
  assert.equal(result.includes(secret), false);
  assert.equal(
    formatFormalRoProvisionFailure(new Error(secret), secret),
    'FORMAL_RO_STAGING_PROVISION_STOPPED:UNKNOWN_STAGE:UNCLASSIFIED_FAILURE'
  );
});

test('context failure reports its stage without external access', async () => {
  let observed = '';
  let touched = false;
  await assert.rejects(
    provisionFormalStagingReader({
      env: { ...stage, VERCEL_API_TOKEN: '' },
      onSafeStage: (value) => {
        observed = value;
      },
      fetchImpl: async () => {
        touched = true;
        throw new Error('unexpected network');
      }
    }),
    /EXISTING_STAGING_SECRETS_REQUIRED/u
  );
  assert.equal(observed, 'VERIFY_CONTEXT');
  assert.equal(touched, false);
});

test('synthetic scope failure identifies the safe stage', async () => {
  let observed = '';
  await assert.rejects(
    provisionFormalStagingReader({
      env: stage,
      onSafeStage: (value) => {
        observed = value;
      },
      resolveScope: async () => {
        throw new Error('private-password');
      }
    }),
    /private-password/u
  );
  assert.equal(observed, 'VERIFY_VERCEL_PROJECT');
});

test('verified client TLS and backend TLS both pass', async () => {
  const host = 'db.' + REF + '.supabase.co';
  const stream = {
    encrypted: true,
    authorized: true,
    servername: host,
    getProtocol: () => 'TLSv1.3',
    getPeerCertificate: () => ({ subject: { CN: 'synthetic' } })
  };
  const client = {
    connection: { stream },
    query: async () => ({ rows: [{ ssl: true }] })
  };
  await assert.doesNotReject(verifyFormalReaderTls(client, host));
  await assert.rejects(
    verifyFormalReaderTls(
      { ...client, connection: { stream: { ...stream, authorized: false } } },
      host
    ),
    /CLIENT_TLS_NOT_VERIFIED/u
  );
  await assert.rejects(
    verifyFormalReaderTls(
      { ...client, query: async () => ({ rows: [{ ssl: false }] }) },
      host
    ),
    /DATABASE_BACKEND_SSL_NOT_VERIFIED/u
  );
});

test('pooler backend without SSL remains a hard stop', async () => {
  const host = 'aws-0-ap-northeast-1.pooler.supabase.com';
  const stream = {
    encrypted: true,
    authorized: true,
    servername: host,
    getProtocol: () => 'TLSv1.3',
    getPeerCertificate: () => ({ subject: { CN: 'synthetic' } })
  };
  const client = {
    connection: { stream },
    query: async () => ({ rows: [{ ssl: false }] })
  };
  await assert.rejects(
    verifyFormalReaderTls(client, host),
    /POOLER_UPSTREAM_SSL_UNVERIFIED/u
  );
  const error = { safeCode: 'POOLER_UPSTREAM_SSL_UNVERIFIED' };
  const diagnostic = formatFormalRoProvisionFailure(
    error,
    'VERIFY_STAGING_ADMIN_TLS'
  );
  assert.equal(
    diagnostic,
    'FORMAL_RO_STAGING_PROVISION_STOPPED:VERIFY_STAGING_ADMIN_TLS:POOLER_UPSTREAM_SSL_UNVERIFIED'
  );
});

test('unknown backend SSL evidence never passes', async () => {
  const host = 'db.' + REF + '.supabase.co';
  const stream = {
    encrypted: true,
    authorized: true,
    servername: host,
    getProtocol: () => 'TLSv1.3',
    getPeerCertificate: () => ({ subject: { CN: 'synthetic' } })
  };
  const client = {
    connection: { stream },
    query: async () => {
      throw new Error('SECRET_MUST_NOT_LEAK');
    }
  };
  await assert.rejects(
    verifyFormalReaderTls(client, host),
    /TLS_BACKEND_EVIDENCE_UNAVAILABLE/u
  );
});
