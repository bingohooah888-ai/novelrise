import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import {
  EXPECTED_PARENT,
  EXPECTED_STAGING,
  EXPECTED_REPOSITORY,
  EXPECTED_WORKFLOW,
  EXPECTED_TABLES,
  READONLY_SCOPE,
  verifyTrustedDispatch,
  inspectManagementRecords,
  inspectConnectionRoute,
  fetchManagementEvidence,
  validateCatalogReadOnlyJson,
  SAFE_IDENTITY_SQL
} from '../scripts/scout-point10x-staging-identity-readonly.mjs';

const mainSha = 'b'.repeat(40);
function env() {
  return {
    GITHUB_ACTIONS: 'true',
    GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_REPOSITORY: EXPECTED_REPOSITORY,
    GITHUB_REF: 'refs/heads/main',
    GITHUB_ACTOR: 'bingohooah888-ai',
    GITHUB_TRIGGERING_ACTOR: 'bingohooah888-ai',
    GITHUB_RUN_ATTEMPT: '1',
    GITHUB_WORKFLOW_REF: EXPECTED_WORKFLOW,
    REQUESTED_SCOPE: READONLY_SCOPE,
    REQUESTED_CONFIRMATION: 'STAGING READONLY IDENTITY APPROVED',
    EXPECTED_MAIN_SHA: mainSha,
    GITHUB_SHA: mainSha,
    STAGING_SUPABASE_URL: 'https://' + EXPECTED_STAGING + '.supabase.co',
    STAGING_DATABASE_URL:
      'postgresql://postgres:synthetic-password@db.' +
      EXPECTED_STAGING +
      '.supabase.co:5432/postgres',
    SUPABASE_ACCESS_TOKEN: 'synthetic-only'
  };
}
function management() {
  return {
    branches: {
      branches: [
        {
          name: 'staging',
          project_ref: EXPECTED_STAGING,
          parent_project_ref: EXPECTED_PARENT,
          is_default: false,
          preview_project_status: 'ACTIVE_HEALTHY',
          persistent: false,
          with_data: false
        }
      ]
    },
    project: {
      id: EXPECTED_STAGING,
      status: 'ACTIVE_HEALTHY',
      database: {
        host: 'db.' + EXPECTED_STAGING + '.supabase.co',
        postgres_engine: '17'
      }
    }
  };
}
const hold = /STAGE38_HOLD:/u;

test('trusted-main dispatch accepts only exact OWNER, SHA, scope and first run', () => {
  assert.equal(verifyTrustedDispatch(env()).sha, mainSha);
  for (const [field, value] of [
    ['GITHUB_ACTIONS', 'false'],
    ['GITHUB_EVENT_NAME', 'issue_comment'],
    ['GITHUB_REF', 'refs/heads/fork'],
    ['GITHUB_REPOSITORY', 'foreign/fork'],
    ['GITHUB_ACTOR', 'attacker'],
    ['GITHUB_TRIGGERING_ACTOR', 'attacker'],
    ['GITHUB_RUN_ATTEMPT', '2'],
    ['GITHUB_WORKFLOW_REF', 'different-workflow'],
    ['REQUESTED_SCOPE', 'staging-backlog-recovery-20261011'],
    ['REQUESTED_CONFIRMATION', 'STAGING WRITE APPROVED'],
    ['EXPECTED_MAIN_SHA', 'invalid-sha'],
    ['GITHUB_SHA', 'a'.repeat(40)]
  ]) {
    const changed = env();
    changed[field] = value;
    assert.throws(() => verifyTrustedDispatch(changed), hold, field);
  }
});

test('branch plus independent dedicated Staging project are both required', () => {
  const m = management();
  const result = inspectManagementRecords(m.branches, m.project);
  assert.equal(result.managementVerified, true);
  assert.equal(result.ref, EXPECTED_STAGING);
  assert.equal(result.postgresMajor, 17);
  assert.throws(
    () => inspectManagementRecords(m.branches, null),
    /STAGING_PROJECT_NOT_FOUND/u
  );
  for (const replacement of [
    { id: EXPECTED_PARENT },
    { status: 'INACTIVE' },
    {
      database: {
        host: 'db.' + EXPECTED_PARENT + '.supabase.co',
        postgres_engine: '17'
      }
    },
    {
      database: {
        host: 'db.' + EXPECTED_STAGING + '.supabase.co',
        postgres_engine: '16'
      }
    },
    {
      database: {
        host: 'db.' + EXPECTED_STAGING + '.supabase.co',
        postgres_engine: 'NaN'
      }
    }
  ]) {
    const x = management();
    Object.assign(x.project, replacement);
    assert.throws(() => inspectManagementRecords(x.branches, x.project), hold);
  }
  const stale = management();
  stale.branches.branches[0].preview_project_status = 'INACTIVE';
  assert.throws(
    () => inspectManagementRecords(stale.branches, stale.project),
    hold
  );
});

test('existing dedicated route inspection is reused, never treated as TLS proof', () => {
  const e = env();
  const managementProof = inspectManagementRecords(
    management().branches,
    management().project
  );
  const route = inspectConnectionRoute(e, managementProof);
  assert.equal(route.sslMode, 'verify-full');
  assert.equal(route.rootCert, 'system');
  assert.equal(route.host, 'db.' + EXPECTED_STAGING + '.supabase.co');
  assert.equal(Object.hasOwn(route, 'password'), false);
  assert.equal(Object.hasOwn(route, 'databaseUrl'), false);
  for (const [key, value] of [
    ['STAGING_SUPABASE_URL', 'https://' + EXPECTED_PARENT + '.supabase.co'],
    [
      'STAGING_DATABASE_URL',
      'postgresql://postgres:synthetic@db.' +
        EXPECTED_PARENT +
        '.supabase.co:5432/postgres'
    ],
    [
      'STAGING_DATABASE_URL',
      'postgresql://postgres:synthetic@db.' +
        EXPECTED_STAGING +
        '.supabase.co:5432/postgres?sslmode=disable'
    ],
    [
      'STAGING_DATABASE_URL',
      'postgresql://postgres:synthetic@wrong-host.example:5432/postgres'
    ]
  ]) {
    const x = env();
    x[key] = value;
    assert.throws(() => inspectConnectionRoute(x, managementProof), hold, key);
  }
  assert.throws(
    () =>
      inspectConnectionRoute(e, {
        managementVerified: false,
        ref: EXPECTED_STAGING
      }),
    hold
  );
});

test('management GETs are read-only and fail closed on missing token and Project NotFound', async () => {
  await assert.rejects(
    fetchManagementEvidence(''),
    /MANAGEMENT_TOKEN_UNAVAILABLE/u
  );
  let calls = 0;
  await assert.rejects(
    fetchManagementEvidence('synthetic-only', async (url, opts) => {
      calls++;
      assert.match(url, /^https:\/\/api\.supabase\.com\/v1\/projects\//u);
      assert.equal(opts.method, 'GET');
      assert.equal(opts.redirect, 'error');
      assert.equal(opts.headers.Authorization, 'Bearer synthetic-only');
      return { ok: false, status: 404 };
    }),
    /MANAGEMENT_PROJECT_NOT_FOUND/u
  );
  assert.equal(calls, 1);
  const data = management();
  const requested = [];
  const returned = await fetchManagementEvidence(
    'synthetic-only',
    async (url, opts) => {
      requested.push(url);
      assert.equal(opts.method, 'GET');
      return {
        ok: true,
        async json() {
          return url.endsWith('/branches') ? data.branches : data.project;
        }
      };
    }
  );
  assert.equal(requested.length, 2);
  assert.equal(returned.project.id, EXPECTED_STAGING);
});

test('synthetic catalog fields never themselves claim live Staging authority', () => {
  const good = {
    database: 'postgres',
    dbRole: 'postgres',
    postgresMajor: 17,
    ssl: true,
    tables: 6,
    cronExtension: true,
    rankCronFunction: true
  };
  const shape = validateCatalogReadOnlyJson(good);
  assert.equal(shape.status, 'NO_GO_SYNTHETIC_CATALOG_SHAPE_ONLY');
  assert.equal(shape.targetTableExpectedCount, EXPECTED_TABLES.length);
  assert.equal(shape.pointConverted, false);
  assert.equal(shape.ninetySecondRuntimeProven, false);
  for (const bad of [
    { database: 'template1' },
    { dbRole: 'admin' },
    { ssl: false },
    { postgresMajor: 16 },
    { tables: 7 },
    { tables: -1 },
    { cronExtension: 'true' },
    { rankCronFunction: 0 }
  ])
    assert.throws(() => validateCatalogReadOnlyJson({ ...good, ...bad }), hold);
});

test('catalog SQL and executable runner are fixed READ ONLY, not injectable via import', () => {
  assert.match(SAFE_IDENTITY_SQL, /^BEGIN READ ONLY; SELECT /u);
  assert.match(SAFE_IDENTITY_SQL, /ROLLBACK;$/u);
  assert.doesNotMatch(
    SAFE_IDENTITY_SQL,
    /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|CALL|ANALYZE)\b/iu
  );
  const source = readFileSync(
    new URL(
      '../scripts/scout-point10x-staging-identity-readonly.mjs',
      import.meta.url
    ),
    'utf8'
  );
  assert.match(source, /PGSSLMODE: 'verify-full'/u);
  assert.match(source, /PGSSLROOTCERT: 'system'/u);
  assert.match(source, /default_transaction_read_only=on/u);
  assert.match(source, /delete childEnv\.STAGING_DATABASE_URL;/u);
  assert.match(source, /delete childEnv\.SUPABASE_ACCESS_TOKEN;/u);
  assert.match(source, /shell: false/u);
  assert.doesNotMatch(
    source,
    /export (?:async )?function (?:runSafeReadOnlyQuery|runStage38)\b/u
  );
});

test('workflow is OWNER-only, main-only and manual Staging; never auto-triggered', () => {
  const file = readFileSync(
    new URL(
      '../.github/workflows/scout-point10x-staging-identity-readonly.yml',
      import.meta.url
    ),
    'utf8'
  );
  assert.match(file, /^on:\s*\n  workflow_dispatch:/mu);
  assert.doesNotMatch(
    file,
    /^\s{2}(?:push|issue_comment|pull_request|schedule):/mu
  );
  assert.match(file, /environment: staging/u);
  assert.match(file, /github\.event\.sender\.id == 317436651/u);
  assert.match(file, /github\.ref == 'refs\/heads\/main'/u);
  assert.match(file, /persist-credentials: false/u);
  assert.match(file, /secrets\.STAGING_DATABASE_URL/u);
  assert.match(file, /secrets\.SUPABASE_ACCESS_TOKEN/u);
  assert.match(
    file,
    /node scripts\/scout-point10x-staging-identity-readonly\.mjs --live-readonly/u
  );
  assert.doesNotMatch(
    file,
    /\b(?:pg_dump|pg_restore|supabase db push|apply_migration|psql -c)\b/u
  );
});
