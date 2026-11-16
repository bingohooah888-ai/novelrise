import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

// prettier-ignore
import { create020705StagingMigrationAdapter, unwrap020705StagingProposal } from '../.github/ai-02-07-05-app-composition/staging-live-migrations.mjs';
// prettier-ignore
import { create020705StagingPreviewAdapter } from '../.github/ai-02-07-05-app-composition/staging-live-preview.mjs';
// prettier-ignore
import { create020705StagingJwtAdapter } from '../.github/ai-02-07-05-app-composition/staging-live-jwt.mjs';

const STAGING = 'wmlzjgvxgoyrovdhbqbg';
const URL = 'https://' + STAGING + '.supabase.co';
const MAIN = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const scope = Object.freeze({
  repository: 'bingohooah888-ai/novelrise',
  prNumber: 2895,
  stagingProjectRef: STAGING,
  supabaseUrl: URL,
  mainSha: MAIN,
  candidateSha: HEAD,
  stagingBranch: 'staging/ai-02-07-05-owner-review',
  maxMigrations: 2,
  maxPreviews: 1,
  maxPaidCalls: 1
});
const DB = 'postgres://postgres.' + STAGING +
  ':synthetic@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres';

// prettier-ignore
function migrationFixture({ drift = false, badSha = false } = {}) {
  const actions = [];
  const applied = ['20261031023000'];
  const fakeContent =
    '-- reviewed SQL\nbegin;\n' +
    "select 1;\n" +
    '-- intentionally at least 100 chars of reviewed SQL content used to test the parser and ledger path\n' +
    'commit;\n';
  const bytes = Buffer.from(fakeContent);
  const blob = createHash('sha1').update('blob ' + bytes.length + '\0')
    .update(bytes).digest('hex');
  const options = {
    scope,
    connectionString: DB,
    githubToken: 'synthetic-token-for-tests',
    mainMigrationFiles: () => ['20261031023000_fixture.sql'],
    async fetchImpl(url) {
      actions.push('github-pinned-file');
      assert.match(url, new RegExp('ref=' + HEAD + '$'));
      const path = new URL(url).pathname.split('/contents/')[1];
      return {
        status: 200,
        async json() {
          return {
            path,
            encoding: 'base64',
            sha: badSha ? 'f'.repeat(40) : blob,
            content: bytes.toString('base64')
          };
        }
      };
    },
    clientFactory() {
      return {
        async connect() { actions.push('connect'); },
        async end() { actions.push('close'); },
        async query(sql, params = []) {
          actions.push(sql);
          if (sql.includes('current_database()'))
            return { rows: [{ database_name: 'postgres', db_role: 'postgres' }] };
          if (sql.startsWith('select version'))
            return { rows: (drift ? ['20261031023000','20261114000000'] : applied)
              .map((version) => ({ version })) };
          if (sql.startsWith('select 1 from supabase_migrations'))
            return { rows: applied.includes(params[0]) ? [{ 1: 1 }] : [] };
          if (sql.startsWith('insert into supabase_migrations')) {
            applied.push(params[0]);
            return { rows: [] };
          }
          return { rows: [] };
        }
      };
    }
  };
  return { options, actions };
}

// prettier-ignore
test('Staging migration adapter installs two fixed, SHA-pinned proposals atomically', async () => {
  const { options, actions } = migrationFixture();
  const adapter = create020705StagingMigrationAdapter(options);
  assert.deepEqual(actions, []);
  try {
    assert.equal(await adapter.installReviewState(), true);
  } catch {
    assert.fail('Synthetic migration fixture trace: ' +
      actions.map((value) => String(value).slice(0, 50)).join('|'));
  }
  assert.equal(await adapter.installChunkClaim(), true);
  assert.equal(actions.filter((x) => x === 'BEGIN').length, 2);
  assert.equal(actions.filter((x) => x === 'COMMIT').length, 2);
  assert.equal(actions.filter((x) => x === 'github-pinned-file').length, 2);
  await assert.rejects(adapter.installReviewState(),
    /AI_020705_STAGING_MIGRATION_DENIED/u);
});

// prettier-ignore
test('Staging migration never applies on remote-only drift, hash tampering or Production', async () => {
  for (const cfg of [{ drift: true }, { badSha: true }]) {
    const { options, actions } = migrationFixture(cfg);
    const adapter = create020705StagingMigrationAdapter(options);
    await assert.rejects(adapter.installReviewState(),
      /AI_020705_STAGING_MIGRATION_DENIED/u);
    assert.equal(actions.includes('BEGIN'), false);
  }
  assert.throws(() => create020705StagingMigrationAdapter({
    ...migrationFixture().options,
    connectionString: DB.replace(STAGING, 'fiepaguycecrredwrcwx')
  }), /AI_020705_STAGING_MIGRATION_DENIED/u);
  assert.throws(() => unwrap020705StagingProposal(
    '-- test\nbegin;\ndrop table auth.users;\n'.repeat(6) + 'commit;'
  ), /AI_020705_STAGING_MIGRATION_DENIED/u);
});

// prettier-ignore
function previewFixture({ missingFlag = false, wrongCommit = false } = {}) {
  const actions = [];
  const projectId = 'prj_testpreview123';
  const token = 'synthetic-vercel-token-for-tests';
  const branch = scope.stagingBranch;
  const required = [
    'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY',
    'NOVELIGHT_STAGING_SUPABASE_URL', 'NOVELIGHT_STAGING_SUPABASE_PUBLISHABLE_KEY',
    'NOVELIGHT_AI_ADMIN_PREVIEW_ENABLED', 'NOVELIGHT_AI_OWNER_REVIEW_STATE_ENABLED',
    'NOVELIGHT_AI_020705_STAGING_PREVIEW_ENABLED', 'NOVELIGHT_AI_020705_ONE_SHOT_ENABLED'
  ];
  const options = {
    scope, projectId, token,
    protectionBypass: 'synthetic-protection-bypass',
    sleep: async () => {},
    async fetchImpl(url, opts = {}) {
      actions.push({ url, method: opts.method || 'GET' });
      let status = 200;
      let payload;
      if (url.includes('/v9/projects/') && url.endsWith('/env')) {
        payload = { envs: required.slice(missingFlag ? 1 : 0).map(
          (key) => ({ key, target: ['preview'], gitBranch: branch })
        ) };
      } else if (url.includes('/v9/projects/')) {
        payload = { id: projectId, name: 'novelrise',
          link: { type: 'github', repo: 'novelrise', repoId: 12345 } };
      } else if (url.endsWith('/v13/deployments')) {
        assert.equal(opts.method, 'POST');
        const sent = JSON.parse(opts.body);
        assert.equal(sent.gitSource.sha, HEAD);
        assert.equal(sent.gitSource.ref, branch);
        assert.notEqual(sent.target, 'production');
        payload = { id: 'dpl_test123' };
      } else if (url.includes('/v13/deployments/')) {
        payload = {
          id: 'dpl_test123', projectId, readyState: 'READY',
          url: 'novelight-synthetic.vercel.app',
          gitSource: { sha: wrongCommit ? MAIN : HEAD, ref: branch }
        };
      } else if (url.endsWith('/api/deployment-revision')) {
        if (!opts.headers) status = 403;
        payload = { commitSha: HEAD };
      } else if (url.endsWith('/api/staging-browser-config')) {
        payload = { supabaseUrl: URL,
          supabasePublishableKey: 'sb_publishable_test' };
      } else throw new Error('UNEXPECTED_URL');
      return { status, json: async () => payload };
    }
  };
  return { options, actions };
}

// prettier-ignore
test('Preview creates at most one branch-locked deployment and checks protected live revision', async () => {
  const { options, actions } = previewFixture();
  const preview = create020705StagingPreviewAdapter(options);
  assert.equal(actions.length, 0);
  const result = await preview.preparePreview();
  assert.equal(result.id, 'dpl_test123');
  assert.equal(result.ssoProtected, true);
  assert.equal(actions.filter((a) => a.method === 'POST').length, 1);
  await assert.rejects(preview.preparePreview(),
    /AI_020705_STAGING_PREVIEW_DENIED/u);
});

// prettier-ignore
test('Preview refuses missing branch-only environment or changed SHA before success', async () => {
  for (const cfg of [{ missingFlag: true }, { wrongCommit: true }]) {
    const { options, actions } = previewFixture(cfg);
    await assert.rejects(
      create020705StagingPreviewAdapter(options).preparePreview(),
      /AI_020705_STAGING_PREVIEW_DENIED/u
    );
    assert.equal(actions.filter((a) => a.method === 'POST').length,
      cfg.missingFlag ? 0 : 1);
  }
});

// prettier-ignore
test('JWT proof will never construct a live adapter for Production or missing secrets', () => {
  assert.throws(() => create020705StagingJwtAdapter({
    scope: { ...scope, supabaseUrl: 'https://fiepaguycecrredwrcwx.supabase.co' }
  }), /AI_020705_STAGING_JWT_DENIED|supabaseUrl is required|supabaseKey is required/u);
});
