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
  extractVerifiedPsqlClientTlsJson,
  validateStagingTlsBoundary,
  SAFE_IDENTITY_SQL,
  classifyPsqlFailure,
  OFFICIAL_SUPABASE_CA_DER_SHA256,
  OFFICIAL_SUPABASE_CA_PEM_SHA256,
  OFFICIAL_SUPABASE_CA_FILE_PATH,
  verifyPinnedSupabaseRootCa
} from '../scripts/scout-point10x-staging-identity-readonly.mjs';

const mainSha = 'b'.repeat(40);
const branchId = '4ea5dd93-4032-4d53-8b4f-46bef5cb50d2';
const listPath =
  'https://api.supabase.com/v1/projects/' + EXPECTED_PARENT + '/branches';
const detailPath = listPath + '/staging';
const hold = /STAGE38_HOLD:/u;

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

function branchRecord() {
  return {
    id: branchId,
    name: 'staging',
    project_ref: EXPECTED_STAGING,
    parent_project_ref: EXPECTED_PARENT,
    is_default: false,
    preview_project_status: 'ACTIVE_HEALTHY',
    persistent: false,
    with_data: false,
    status: 'FUNCTIONS_DEPLOYED'
  };
}

function management() {
  return {
    branches: {
      branches: [
        {
          ...branchRecord(),
          id: 'a6470780-fdae-40ab-965d-c2ae885af7a6',
          name: 'main',
          project_ref: EXPECTED_PARENT,
          is_default: true
        },
        branchRecord()
      ]
    },
    branch: branchRecord()
  };
}

test('trusted main dispatch refuses incorrect actor, SHA, branch, retry, or scope', () => {
  assert.equal(verifyTrustedDispatch(env()).sha, mainSha);
  for (const [field, value] of [
    ['GITHUB_ACTIONS', 'false'],
    ['GITHUB_EVENT_NAME', 'issue_comment'],
    ['GITHUB_REF', 'refs/heads/fork'],
    ['GITHUB_REPOSITORY', 'foreign/fork'],
    ['GITHUB_ACTOR', 'attacker'],
    ['GITHUB_TRIGGERING_ACTOR', 'attacker'],
    ['GITHUB_RUN_ATTEMPT', '2'],
    ['GITHUB_WORKFLOW_REF', 'wrong-ref'],
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

test('safe parent Branch list plus named Branch GET attest to the same Staging ref', () => {
  const m = management();
  const result = inspectManagementRecords(m.branches, m.branch);
  assert.equal(result.managementVerified, true);
  assert.equal(result.ref, EXPECTED_STAGING);
  assert.equal(result.parentRef, EXPECTED_PARENT);
  assert.equal(result.branchId, branchId);
  assert.equal(
    result.expectedDbHost,
    'db.' + EXPECTED_STAGING + '.supabase.co'
  );
  assert.equal(result.postgresVersionVerified, false);
  assert.equal(Object.hasOwn(result, 'postgresMajor'), false);
  assert.equal(Object.hasOwn(result, 'password'), false);
});

test('Supabase list array with independent branch statuses still validates only pinned fields', () => {
  const m = management();
  const records = m.branches.branches;
  records[1].status = 'CREATING_PROJECT';
  const proof = inspectManagementRecords(records, m.branch);
  assert.equal(proof.managementVerified, true);
  assert.equal(proof.branchId, branchId);
});

test('named Branch GET may omit preview_project_status when list is ACTIVE_HEALTHY', () => {
  const m = management();
  delete m.branch.preview_project_status;
  const proof = inspectManagementRecords(m.branches, m.branch);
  assert.equal(proof.managementVerified, true);
  assert.equal(proof.branchId, branchId);
});

test('named Branch GET must reject a present unhealthy preview_project_status', () => {
  for (const value of ['INACTIVE', 'PAUSED', null, undefined, false]) {
    const m = management();
    m.branch.preview_project_status = value;
    let failure;
    try {
      inspectManagementRecords(m.branches, m.branch);
    } catch (error) {
      failure = error;
    }
    assert.equal(failure?.safeCode, 'STAGING_BRANCH_IDENTITY_MISMATCH');
    assert.ok(
      failure.safeDiagnostics.some(
        (entry) =>
          entry.view === 'named' &&
          entry.field === 'preview_project_status' &&
          entry.present === true &&
          entry.matchesExpected === false
      )
    );
  }
});

test('list Branch preview_project_status remains mandatory even if named GET omits it', () => {
  for (const value of ['MISSING', 'INACTIVE', null, undefined, false]) {
    const m = management();
    delete m.branch.preview_project_status;
    if (value === 'MISSING')
      delete m.branches.branches[1].preview_project_status;
    else m.branches.branches[1].preview_project_status = value;
    let failure;
    try {
      inspectManagementRecords(m.branches, m.branch);
    } catch (error) {
      failure = error;
    }
    assert.equal(failure?.safeCode, 'STAGING_BRANCH_IDENTITY_MISMATCH');
    assert.ok(
      failure.safeDiagnostics.some(
        (entry) =>
          entry.view === 'list' &&
          entry.field === 'preview_project_status' &&
          entry.present === (value !== 'MISSING') &&
          entry.matchesExpected === false
      )
    );
  }
});

test('all missing named identity fields are classified without leaking values', () => {
  for (const field of [
    'id',
    'name',
    'project_ref',
    'parent_project_ref',
    'is_default',
    'persistent',
    'with_data'
  ]) {
    const m = management();
    delete m.branch[field];
    let failure;
    try {
      inspectManagementRecords(m.branches, m.branch);
    } catch (error) {
      failure = error;
    }
    assert.equal(failure?.safeCode, 'STAGING_BRANCH_IDENTITY_MISMATCH');
    assert.ok(
      failure.safeDiagnostics.some(
        (entry) =>
          entry.view === 'named' &&
          entry.field === field &&
          entry.present === false &&
          entry.matchesExpected === false
      ),
      field
    );
    assert.doesNotMatch(
      JSON.stringify(failure.safeDiagnostics),
      /fiepaguycecrredwrcwx|wmlzjgvxgoyrovdhbqbg/u
    );
  }
});

test('missing or malformed Branch detail fails closed', () => {
  const m = management();
  for (const bad of [null, undefined, [], {}, { name: 'staging' }]) {
    assert.throws(() => inspectManagementRecords(m.branches, bad), hold);
  }
  for (const list of [null, {}, { branches: null }, { branches: {} }]) {
    assert.throws(() => inspectManagementRecords(list, m.branch), hold);
  }
});

test('named branch must agree with listed branch on every identity and state field', () => {
  const changes = [
    { id: 'a6470780-fdae-40ab-965d-c2ae885af7a6' },
    { id: 'not-a-uuid' },
    { name: 'main' },
    { project_ref: EXPECTED_PARENT },
    { parent_project_ref: EXPECTED_STAGING },
    { is_default: true },
    { preview_project_status: 'INACTIVE' },
    { persistent: true },
    { with_data: true }
  ];
  for (const change of changes) {
    const m = management();
    Object.assign(m.branch, change);
    assert.throws(() => inspectManagementRecords(m.branches, m.branch), hold);
  }
});

test('listed branch must itself be healthy and exactly one non-default Staging', () => {
  const changes = [
    { id: 'not-uuid' },
    { name: 'other' },
    { project_ref: EXPECTED_PARENT },
    { parent_project_ref: 'wrong-parent' },
    { is_default: true },
    { preview_project_status: 'INACTIVE' },
    { persistent: true },
    { with_data: true }
  ];
  for (const change of changes) {
    const m = management();
    Object.assign(m.branches.branches[1], change);
    assert.throws(() => inspectManagementRecords(m.branches, m.branch), hold);
  }
  const dup = management();
  dup.branches.branches.push({ ...branchRecord() });
  assert.throws(() => inspectManagementRecords(dup.branches, dup.branch), hold);
  const collidingRef = management();
  collidingRef.branches.branches.push({ ...branchRecord(), name: 'other' });
  assert.throws(
    () => inspectManagementRecords(collidingRef.branches, collidingRef.branch),
    hold
  );
});

test('mismatch diagnostic gathers all failures from both views but never raw values', () => {
  const m = management();
  m.branches.branches[1].with_data = 'false';
  m.branch.project_ref = 'SYNTHETIC_SECRET_MUST_NOT_PRINT';
  m.branch.is_default = 'false';
  delete m.branch.parent_project_ref;
  m.branch.id = 'a6470780-fdae-40ab-965d-c2ae885af7a6';
  let failure;
  try {
    inspectManagementRecords(m.branches, m.branch);
  } catch (error) {
    failure = error;
  }
  assert.equal(failure?.safeCode, 'STAGING_BRANCH_IDENTITY_MISMATCH');
  assert.deepEqual(failure.safeDiagnostics, [
    { view: 'list', field: 'with_data', present: true, matchesExpected: false },
    {
      view: 'named',
      field: 'project_ref',
      present: true,
      matchesExpected: false
    },
    {
      view: 'named',
      field: 'parent_project_ref',
      present: false,
      matchesExpected: false
    },
    {
      view: 'named',
      field: 'is_default',
      present: true,
      matchesExpected: false
    },
    { view: 'crosscheck', field: 'id', present: true, matchesExpected: false }
  ]);
  assert.doesNotMatch(
    JSON.stringify({
      message: failure.message,
      fields: failure.safeDiagnostics
    }),
    /SYNTHETIC_SECRET_MUST_NOT_PRINT|fiepaguycecrredwrcwx|wmlzjgvxgoyrovdhbqbg/u
  );
});

test('existing dedicated route validator is reused, not mistaken for TLS proof', () => {
  const e = env();
  const proof = inspectManagementRecords(
    management().branches,
    management().branch
  );
  const route = inspectConnectionRoute(e, proof);
  assert.equal(route.sslMode, 'verify-full');
  assert.equal(route.rootCert, 'official-supabase-root-2021-pinned');
  assert.equal(route.host, 'db.' + EXPECTED_STAGING + '.supabase.co');
  assert.equal(Object.hasOwn(route, 'password'), false);
  assert.equal(Object.hasOwn(route, 'databaseUrl'), false);
  for (const [key, value] of [
    ['STAGING_SUPABASE_URL', 'https://' + EXPECTED_PARENT + '.supabase.co'],
    [
      'STAGING_DATABASE_URL',
      'postgresql://postgres:pass@db.' +
        EXPECTED_PARENT +
        '.supabase.co:5432/postgres'
    ],
    [
      'STAGING_DATABASE_URL',
      'postgresql://postgres:pass@db.' +
        EXPECTED_STAGING +
        '.supabase.co:5432/postgres?sslmode=disable'
    ],
    [
      'STAGING_DATABASE_URL',
      'postgresql://postgres:pass@evil.example:5432/postgres'
    ]
  ]) {
    const changed = env();
    changed[key] = value;
    assert.throws(() => inspectConnectionRoute(changed, proof), hold, key);
  }
  assert.throws(
    () => inspectConnectionRoute(e, { managementVerified: false }),
    hold
  );
});

test('Staging session pooler preserves exact hostname and pinned CA under verify-full', () => {
  const proof = inspectManagementRecords(
    management().branches,
    management().branch
  );
  const e = env();
  const host = 'aws-0-ap-northeast-1.pooler.supabase.com';
  const base =
    'postgresql://postgres.' + EXPECTED_STAGING + ':synthetic-password@';
  e.STAGING_DATABASE_URL = base + host + ':5432/postgres';
  const route = inspectConnectionRoute(e, proof);
  assert.equal(route.connectionMode, 'session-pooler');
  assert.equal(route.host, host);
  assert.equal(route.port, '5432');
  assert.equal(route.sslMode, 'verify-full');
  assert.equal(route.rootCert, 'official-supabase-root-2021-pinned');
  assert.equal(Object.hasOwn(route, 'password'), false);
  for (const wrong of [
    base + host + ':6543/postgres',
    base + 'aws-0-evil.example.com:5432/postgres',
    'postgresql://postgres.' +
      EXPECTED_PARENT +
      ':synthetic-password@' +
      host +
      ':5432/postgres'
  ]) {
    const candidate = { ...e, STAGING_DATABASE_URL: wrong };
    assert.throws(
      () => inspectConnectionRoute(candidate, proof),
      /STAGE38_HOLD:/u
    );
  }
});
test('management API uses ONLY parent-scoped list and by-name GET in fixed order', async () => {
  const m = management();
  const urls = [];
  const result = await fetchManagementEvidence(
    'synthetic-only',
    async (url, opts) => {
      urls.push(url);
      assert.equal(opts.method, 'GET');
      assert.equal(opts.redirect, 'error');
      assert.equal(opts.headers.Authorization, 'Bearer synthetic-only');
      assert.equal(opts.headers.Accept, 'application/json');
      assert.ok(url === listPath || url === detailPath);
      return {
        ok: true,
        async json() {
          return url === listPath ? m.branches : m.branch;
        }
      };
    }
  );
  assert.deepEqual(urls, [listPath, detailPath]);
  assert.equal(result.branch.id, branchId);
  assert.equal(Object.hasOwn(result, 'project'), false);
  assert.ok(!urls.some((url) => url.includes('/v1/branches/')));
  assert.ok(!urls.some((url) => url.includes('projects/' + EXPECTED_STAGING)));
  assert.equal(
    inspectManagementRecords(result.branches, result.branch).branchId,
    branchId
  );
});

test('management token missing, 401, 403, 404, 429, and network failures all HOLD', async () => {
  await assert.rejects(
    fetchManagementEvidence('', async () => {
      throw Error('must never be called with missing token');
    }),
    /MANAGEMENT_TOKEN_UNAVAILABLE/u
  );
  for (const status of [401, 403, 404, 429, 500]) {
    for (const failingIndex of [0, 1]) {
      const requested = [];
      const m = management();
      await assert.rejects(
        fetchManagementEvidence('synthetic-only', async (url) => {
          requested.push(url);
          if (requested.length === failingIndex + 1)
            return { ok: false, status };
          return {
            ok: true,
            async json() {
              return url === listPath ? m.branches : m.branch;
            }
          };
        }),
        status === 404 ? /MANAGEMENT_BRANCH_NOT_FOUND/u : hold
      );
      assert.equal(requested.length, failingIndex + 1);
    }
  }
  await assert.rejects(
    fetchManagementEvidence('synthetic-only', async () => {
      throw Error('synthetic transport error');
    }),
    /MANAGEMENT_REQUEST_FAILED/u
  );
});

test('malformed Management response and duplicate staging can never be treated as proven', async () => {
  await assert.rejects(
    fetchManagementEvidence('synthetic-only', async () => ({
      ok: true,
      async json() {
        throw Error('invalid json');
      }
    })),
    /MANAGEMENT_JSON_INVALID/u
  );
  const bad = management();
  bad.branches.branches[1].parent_project_ref = EXPECTED_STAGING;
  assert.throws(() => inspectManagementRecords(bad.branches, bad.branch), hold);
});

test('synthetic catalog shape cannot claim live Staging authority', () => {
  const valid = {
    database: 'postgres',
    dbRole: 'postgres',
    postgresMajor: 17,
    ssl: true,
    tables: 6,
    cronExtension: true,
    rankCronFunction: true
  };
  const result = validateCatalogReadOnlyJson(valid);
  assert.equal(result.status, 'NO_GO_SYNTHETIC_CATALOG_SHAPE_ONLY');
  assert.equal(result.targetTableExpectedCount, EXPECTED_TABLES.length);
  assert.equal(result.pointConverted, false);
  assert.equal(result.ninetySecondRuntimeProven, false);
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
    assert.throws(
      () => validateCatalogReadOnlyJson({ ...valid, ...bad }),
      hold
    );
});

test('catalog failures report only fixed condition names', () => {
  const valid = {
    database: 'postgres',
    dbRole: 'postgres',
    postgresMajor: 17,
    ssl: true,
    tables: EXPECTED_TABLES.length,
    cronExtension: false,
    rankCronFunction: false
  };
  const cases = [
    [{ database: 'SYNTHETIC_SECRET' }, 'DATABASE_NAME'],
    [{ dbRole: 'SYNTHETIC_SECRET' }, 'DATABASE_ROLE'],
    [{ ssl: false }, 'SSL_ACTIVE'],
    [{ postgresMajor: 16 }, 'POSTGRES_MAJOR_VERSION'],
    [{ tables: -1 }, 'TABLE_COUNT_RANGE'],
    [{ tables: EXPECTED_TABLES.length + 1 }, 'TABLE_COUNT_RANGE'],
    [{ cronExtension: 'SYNTHETIC_SECRET' }, 'CRON_EXTENSION_TYPE'],
    [{ rankCronFunction: 'SYNTHETIC_SECRET' }, 'RANK_CRON_FUNCTION_TYPE']
  ];
  for (const [changes, expectedName] of cases) {
    assert.throws(
      () => validateCatalogReadOnlyJson({ ...valid, ...changes }),
      (error) => {
        assert.equal(error?.safeCode, 'SERVER_IDENTITY_OR_SCHEMA_INVALID');
        assert.deepEqual(error.safeDiagnostics, [expectedName]);
        assert.doesNotMatch(
          JSON.stringify(error.safeDiagnostics),
          /SYNTHETIC_SECRET|password|dbRole/iu
        );
        return true;
      }
    );
  }
  assert.throws(
    () => validateCatalogReadOnlyJson(null),
    (error) => {
      assert.deepEqual(error.safeDiagnostics, ['CATALOG_RESULT_SHAPE']);
      return true;
    }
  );
  assert.throws(
    () =>
      validateCatalogReadOnlyJson({
        ...valid,
        database: 'SYNTHETIC_SECRET',
        ssl: false
      }),
    (error) => {
      assert.deepEqual(error.safeDiagnostics, ['DATABASE_NAME', 'SSL_ACTIVE']);
      return true;
    }
  );
});

test('psql failures map to a fixed safe code without exposing native details', () => {
  const cases = [
    [
      { error: { code: 'ENOENT', message: 'SYNTHETIC_SECRET' } },
      'PSQL_EXECUTABLE_UNAVAILABLE'
    ],
    [{ error: { code: 'EACCES' } }, 'PSQL_EXECUTABLE_UNAVAILABLE'],
    [{ error: { code: 'EPERM' } }, 'PSQL_EXECUTABLE_UNAVAILABLE'],
    [
      { error: { code: 'ETIMEDOUT', message: 'SYNTHETIC_SECRET' } },
      'PSQL_TIMEOUT'
    ],
    [
      {
        status: 2,
        stderr:
          'psql: error: could not translate host name SYNTHETIC_SECRET to address'
      },
      'PSQL_DNS_OR_NETWORK_FAILURE'
    ],
    [
      {
        status: 2,
        stderr: 'psql: error: connection refused at SYNTHETIC_SECRET'
      },
      'PSQL_DNS_OR_NETWORK_FAILURE'
    ],
    [
      { status: 2, stderr: 'psql: error: network is unreachable' },
      'PSQL_DNS_OR_NETWORK_FAILURE'
    ],
    [
      {
        status: 2,
        stderr: 'psql: error: connection timed out at SYNTHETIC_SECRET'
      },
      'PSQL_TIMEOUT'
    ],
    [
      {
        status: 2,
        stderr:
          'psql: error: ssl error: certificate verify failed SYNTHETIC_SECRET'
      },
      'PSQL_TLS_CHAIN_REJECTED'
    ],
    [
      {
        status: 2,
        stderr: 'psql: error: root certificate file is missing SYNTHETIC_SECRET'
      },
      'PSQL_TLS_CA_FILE_UNAVAILABLE'
    ],
    [
      {
        status: 2,
        stderr:
          'psql: error: password authentication failed for user SYNTHETIC_SECRET'
      },
      'PSQL_AUTHENTICATION_FAILURE'
    ],
    [
      {
        status: 2,
        stderr: 'psql: error: no pg_hba.conf entry for host SYNTHETIC_SECRET'
      },
      'PSQL_AUTHENTICATION_FAILURE'
    ],
    [
      { status: 3, stderr: 'ERROR: synthetic SQL error with SYNTHETIC_SECRET' },
      'PSQL_SQL_ERROR'
    ],
    [
      { status: 1, stderr: 'SYNTHETIC_SECRET unknown native failure' },
      'PSQL_FAILURE_UNCLASSIFIED'
    ],
    [
      {
        status: 2,
        stderr:
          'connection to server at SYNTHETIC_SECRET failed: unfamiliar server policy'
      },
      'PSQL_FAILURE_UNCLASSIFIED'
    ],
    [{ status: null, stderr: null }, 'PSQL_FAILURE_UNCLASSIFIED'],
    [
      {
        status: 2,
        stderr: {
          toString() {
            throw Error('should not be called');
          }
        }
      },
      'PSQL_FAILURE_UNCLASSIFIED'
    ]
  ];
  for (const [input, code] of cases) {
    const actual = classifyPsqlFailure(input);
    assert.equal(actual, code);
    assert.match(actual, /^PSQL_[A-Z_]+$/u);
    assert.doesNotMatch(actual, /SYNTHETIC_SECRET|password|stderr|:5432|@/iu);
  }
});

test('psql failure classification prioritizes SQL exit and TLS over generic connection text', () => {
  assert.equal(
    classifyPsqlFailure({
      status: 3,
      stderr: 'ERROR: could not translate host name SYNTHETIC_SECRET'
    }),
    'PSQL_SQL_ERROR'
  );
  assert.equal(
    classifyPsqlFailure({
      status: 2,
      stderr:
        'connection to server at SYNTHETIC_SECRET failed: SSL error: certificate verify failed'
    }),
    'PSQL_TLS_CHAIN_REJECTED'
  );
  assert.equal(
    classifyPsqlFailure({
      status: 2,
      stderr:
        'connection to server at SYNTHETIC_SECRET failed: FATAL: password authentication failed'
    }),
    'PSQL_AUTHENTICATION_FAILURE'
  );
  assert.equal(classifyPsqlFailure(undefined), 'PSQL_FAILURE_UNCLASSIFIED');
});
test('TLS failures keep CA, hostname and unsupported settings separate without stderr disclosure', () => {
  const cases = [
    [
      'psql: error: root certificate file "system" does not exist at SYNTHETIC_SECRET',
      'PSQL_TLS_CA_FILE_UNAVAILABLE'
    ],
    [
      'psql: error: could not read root certificate file "SYNTHETIC_SECRET"',
      'PSQL_TLS_CA_FILE_UNAVAILABLE'
    ],
    [
      'psql: error: server certificate for "SYNTHETIC_SECRET" does not match host name "SYNTHETIC_SECRET"',
      'PSQL_TLS_HOSTNAME_MISMATCH'
    ],
    [
      'connection to server at SYNTHETIC_SECRET failed: certificate does not match host name "SYNTHETIC_SECRET"',
      'PSQL_TLS_HOSTNAME_MISMATCH'
    ],
    [
      'psql: error: invalid value for sslrootcert at SYNTHETIC_SECRET',
      'PSQL_TLS_CONFIGURATION_REJECTED'
    ],
    [
      'psql: error: unsupported sslrootcert value SYNTHETIC_SECRET',
      'PSQL_TLS_CONFIGURATION_REJECTED'
    ],
    [
      'psql: error: SSL error: certificate verify failed SYNTHETIC_SECRET',
      'PSQL_TLS_CHAIN_REJECTED'
    ],
    [
      'psql: error: self-signed certificate from SYNTHETIC_SECRET',
      'PSQL_TLS_CHAIN_REJECTED'
    ],
    [
      'psql: error: certificate has expired for SYNTHETIC_SECRET',
      'PSQL_TLS_CHAIN_REJECTED'
    ],
    [
      'psql: error: server certificate error at SYNTHETIC_SECRET',
      'PSQL_TLS_CERTIFICATE_FAILURE'
    ],
    [
      'psql: error: TLS handshake failed at SYNTHETIC_SECRET',
      'PSQL_TLS_CERTIFICATE_FAILURE'
    ],
    [
      'psql: error: unfamiliar TLS problem at SYNTHETIC_SECRET',
      'PSQL_FAILURE_UNCLASSIFIED'
    ]
  ];
  for (const [stderr, expected] of cases) {
    const result = classifyPsqlFailure({ status: 2, stderr });
    assert.equal(result, expected);
    assert.match(result, /^PSQL_[A-Z_]+$/u);
    assert.doesNotMatch(result, /SYNTHETIC_SECRET|password|stderr|:5432|@/iu);
  }
});

test('TLS details win over generic network wrappers but never hide a SQL/script failure', () => {
  assert.equal(
    classifyPsqlFailure({
      status: 2,
      stderr:
        'connection to server at SYNTHETIC_SECRET failed: server certificate for SYNTHETIC_SECRET does not match host name SYNTHETIC_SECRET'
    }),
    'PSQL_TLS_HOSTNAME_MISMATCH'
  );
  assert.equal(
    classifyPsqlFailure({
      status: 3,
      stderr:
        'ERROR: server certificate for SYNTHETIC_SECRET does not match host name SYNTHETIC_SECRET'
    }),
    'PSQL_SQL_ERROR'
  );
  assert.equal(
    classifyPsqlFailure({
      status: 2,
      stderr: {
        toString() {
          throw Error('SYNTHETIC_SECRET never stringify native error');
        }
      }
    }),
    'PSQL_FAILURE_UNCLASSIFIED'
  );
});
test('official Supabase public CA root is pinned; modification fails closed', () => {
  const pem = readFileSync(OFFICIAL_SUPABASE_CA_FILE_PATH, 'utf8');
  assert.equal(verifyPinnedSupabaseRootCa(pem), true);
  assert.equal(
    OFFICIAL_SUPABASE_CA_DER_SHA256,
    '807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa'
  );
  assert.equal(
    OFFICIAL_SUPABASE_CA_PEM_SHA256,
    '700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7'
  );
  const invalid = [
    '',
    null,
    undefined,
    pem + 'SYNTHETIC_UNTRUSTED_TRAILER',
    pem.replace('-----BEGIN CERTIFICATE-----', '-----BEGIN PRIVATE KEY-----'),
    pem.replace(/(?<=-----BEGIN CERTIFICATE-----\n)[A-Za-z0-9]/u, 'Z'),
    pem.replace(
      '-----END CERTIFICATE-----',
      '-----END UNTRUSTED CERTIFICATE-----'
    )
  ];
  for (const candidate of invalid) {
    let failure;
    try {
      verifyPinnedSupabaseRootCa(candidate);
    } catch (error) {
      failure = error;
    }
    assert.equal(failure?.safeCode, 'SUPABASE_OFFICIAL_CA_UNVERIFIED');
    assert.doesNotMatch(
      String(failure?.message),
      /SYNTHETIC_UNTRUSTED_TRAILER|BEGIN PRIVATE KEY/iu
    );
  }
});
test('fixed catalog SQL is read-only; executable runner remains internal only', () => {
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
  assert.match(source, /PGSSLROOTCERT: caPath/u);
  assert.match(source, /const caPath = verifiedSupabaseRootCaPath\(\)/u);
  assert.match(source, /default_transaction_read_only=on/u);
  assert.match(source, /delete childEnv\.STAGING_DATABASE_URL;/u);
  assert.match(source, /delete childEnv\.SUPABASE_ACCESS_TOKEN;/u);
  assert.match(source, /shell: false/u);
  assert.doesNotMatch(
    source,
    /export (?:async )?function (?:runSafeReadOnlyQuery|runStage38)\b/u
  );
});

test('workflow remains OWNER manual-only Staging; unchanged by 3.9A', () => {
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

test('libpq TLS proof is distinct from PostgreSQL backend TLS', () => {
  const json = JSON.stringify({
    database: 'postgres',
    dbRole: 'postgres',
    postgresMajor: 17,
    ssl: true,
    tables: EXPECTED_TABLES.length,
    cronExtension: false,
    rankCronFunction: false
  });
  const sample = [
    'You are connected to database postgres as user postgres on host SYNTHETIC_HOST at port 5432.',
    'SSL connection (protocol: TLSv1.3, cipher: TLS_AES_256_GCM_SHA384, compression: off)',
    json
  ].join('\n');
  assert.equal(extractVerifiedPsqlClientTlsJson(sample), json);
  assert.equal(
    extractVerifiedPsqlClientTlsJson(sample.replace('TLSv1.3', 'TLSv1.2')),
    json
  );
  for (const invalid of [
    sample.replace('SSL connection (', 'No SSL connection ('),
    sample.replace('TLSv1.3', 'TLSv1.1'),
    sample.replace('compression: off', 'compression: on'),
    sample.replace('cipher: TLS_AES_256_GCM_SHA384', 'cipher: '),
    sample.replace('SSL connection (', 'ssl connection ('),
    sample + '\nSYNTHETIC_SECRET',
    sample.replace(json, 'SYNTHETIC_SECRET'),
    sample.replace(
      json,
      'SSL connection (protocol: TLSv1.3, cipher: TLS_AES_256_GCM_SHA384, compression: off)\n' +
        json
    ),
    null,
    ''
  ]) {
    assert.throws(
      () => extractVerifiedPsqlClientTlsJson(invalid),
      (error) => {
        assert.equal(error.safeCode, 'CLIENT_TLS_EVIDENCE_INVALID');
        assert.doesNotMatch(error.message, /SYNTHETIC_SECRET|SYNTHETIC_HOST/u);
        return true;
      }
    );
  }
});

test('session-pooler upstream SSL false remains NO-GO after client TLS validation', () => {
  const valid = {
    database: 'postgres',
    dbRole: 'postgres',
    postgresMajor: 17,
    ssl: true,
    tables: EXPECTED_TABLES.length,
    cronExtension: true,
    rankCronFunction: false
  };
  assert.equal(
    validateStagingTlsBoundary(valid, 'session-pooler').status,
    'NO_GO_SYNTHETIC_CATALOG_SHAPE_ONLY'
  );
  assert.throws(
    () =>
      validateStagingTlsBoundary({ ...valid, ssl: false }, 'session-pooler'),
    (error) => {
      assert.equal(error.safeCode, 'POOLER_UPSTREAM_SSL_UNVERIFIED');
      return true;
    }
  );
  assert.throws(
    () => validateStagingTlsBoundary({ ...valid, ssl: false }, 'direct'),
    (error) => {
      assert.equal(error.safeCode, 'SERVER_IDENTITY_OR_SCHEMA_INVALID');
      assert.deepEqual(error.safeDiagnostics, ['SSL_ACTIVE']);
      return true;
    }
  );
});

test('live runner requires pinned CA, verify-full, psql conninfo TLS, and no SSL bypass', () => {
  const source = readFileSync(
    new URL(
      '../scripts/scout-point10x-staging-identity-readonly.mjs',
      import.meta.url
    ),
    'utf8'
  );
  assert.match(source, /PGSSLMODE: 'verify-full'/u);
  assert.match(source, /PGSSLROOTCERT: caPath/u);
  assert.match(source, /extractVerifiedPsqlClientTlsJson\(child\.stdout\)/u);
  assert.match(
    source,
    /validateStagingTlsBoundary\(result, route\.connectionMode\)/u
  );
  assert.match(source, /conninfo/u);
  assert.match(
    source,
    /PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=4000'/u
  );
});
