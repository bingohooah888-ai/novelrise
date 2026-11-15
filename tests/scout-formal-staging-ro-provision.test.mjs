import assert from 'node:assert/strict';
import test from 'node:test';
import { URL } from 'node:url';
import {
  deriveFormalReaderDatabaseUrl,
  FORMAL_RO_SAFE_FAILURE_STAGES,
  formalReaderFailureStage,
  makeScramVerifier,
  provisionFormalStagingReader,
  verifyFormalReaderProvisionContext
} from '../scripts/scout-formal-staging-ro-provision.mjs';

const REF = 'wmlzjgvxgoyrovdhbqbg';
const BRANCH = 'feature/scout-formal-last-mile-integrity-off-20261115';
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

test('diagnostic stage log accepts only fixed codes', () => {
  const stages = FORMAL_RO_SAFE_FAILURE_STAGES;
  assert.equal(
    formalReaderFailureStage({ safeStage: stages.SECRET_ATTEMPT }),
    'W20_VERCEL_SECRET_WRITE_UNVERIFIED'
  );
  assert.equal(
    formalReaderFailureStage({ safeStage: 'fake-token-private' }),
    stages.UNKNOWN
  );
  assert.equal(formalReaderFailureStage(null), stages.UNKNOWN);
});

test('prewrite injected errors cannot expose Vercel credentials', async () => {
  const secret = 'synthetic-secret-must-never-appear';
  await assert.rejects(
    provisionFormalStagingReader({
      env: { ...stage, VERCEL_API_TOKEN: secret },
      resolveScope: async () => {
        throw new Error('Failed with credential ' + secret);
      }
    }),
    (error) => {
      assert.equal(error.safeStage, FORMAL_RO_SAFE_FAILURE_STAGES.SCOPE);
      assert.equal(error.message.includes(secret), false);
      assert.equal(error.cause, undefined);
      return true;
    }
  );
});

function syntheticStagingAdmin({ failPassword, failLogin, failReader }) {
  return class {
    constructor(options) {
      this.isReader = options.user !== 'postgres';
    }

    async connect() {
      if (this.isReader && failReader) {
        throw new Error('synthetic reader connection failure');
      }
    }

    async query(sql) {
      if (sql.includes('pg_stat_ssl')) return { rows: [{ ssl: true }] };
      if (sql.includes('current_user as name')) {
        return { rows: [{ name: 'postgres' }] };
      }
      if (sql.includes('select rolcanlogin')) {
        return {
          rows: [
            {
              rolcanlogin: false,
              rolsuper: false,
              rolbypassrls: false,
              rolinherit: false
            }
          ]
        };
      }
      if (sql.includes('has_column_privilege')) {
        return {
          rows: [
            {
              rls: true,
              column_select: true,
              broad_select: false,
              can_write: false,
              policy: true
            }
          ]
        };
      }
      if (sql.includes(' PASSWORD ')) {
        if (failPassword) throw new Error('synthetic password failure');
        return { rows: [] };
      }
      if (sql.endsWith(' LOGIN')) {
        if (failLogin) throw new Error('synthetic login uncertainty');
        return { rows: [] };
      }
      if (sql.endsWith(' NOLOGIN')) return { rows: [] };
      throw new Error('unexpected synthetic SQL query');
    }

    async end() {}
  };
}

async function runSyntheticProvision({
  failPassword,
  failSecret,
  failLogin,
  failReader,
  expectedStage
}) {
  let secretWasRequested = false;
  const fetchImpl = async (_url, options) => {
    if (options?.method === 'POST') {
      secretWasRequested = true;
      if (failSecret) throw new Error('synthetic secret mutation uncertainty');
      return { ok: true };
    }
    return {
      ok: true,
      json: async () => ({
        envs: secretWasRequested
          ? [
              {
                key: 'STAGING_FORMAL_RO_DATABASE_URL',
                gitBranch: BRANCH,
                type: 'sensitive',
                target: ['preview']
              }
            ]
          : []
      })
    };
  };
  await assert.rejects(
    provisionFormalStagingReader({
      env: stage,
      resolveScope: async () => ({
        projectId: 'prj_SmotUNrcyuUntdWTayzWeJ8eQGqe',
        teamId: 'team_2XFgtRCPJQ6pbrEa4mOLQAEx'
      }),
      ClientImpl: syntheticStagingAdmin({
        failPassword,
        failLogin,
        failReader
      }),
      fetchImpl
    }),
    (error) => {
      assert.match(error.message, /^FORMAL_RO_PROVISION_HOLD:[A-Z0-9_]+$/u);
      assert.equal(error.cause, undefined);
      assert.equal(error.safeStage, expectedStage);
      return true;
    }
  );
}

test('password write failure stays uncertain', async () => {
  await runSyntheticProvision({
    failPassword: true,
    expectedStage: FORMAL_RO_SAFE_FAILURE_STAGES.PASSWORD_ATTEMPT
  });
});

test('secret write failure stays uncertain', async () => {
  await runSyntheticProvision({
    failSecret: true,
    expectedStage: FORMAL_RO_SAFE_FAILURE_STAGES.SECRET_ATTEMPT
  });
});

test('synthetic login failure does not claim rollback succeeded', async () => {
  await runSyntheticProvision({
    failLogin: true,
    expectedStage: FORMAL_RO_SAFE_FAILURE_STAGES.LOGIN_ATTEMPT
  });
});

test('synthetic reader failure runs the guarded NOLOGIN rollback', async () => {
  await runSyntheticProvision({
    failReader: true,
    expectedStage: FORMAL_RO_SAFE_FAILURE_STAGES.ROLLBACK_DONE
  });
});
