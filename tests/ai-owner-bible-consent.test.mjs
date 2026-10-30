import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

import { createOwnerNovelBibleConsentPermissionCheck } from '../api/_lib/ai/owner-novel-bible-consent.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const PURPOSE = 'external-novel-bible-analysis';
const REVISION = 'novel-bible-2026-10-30-v1';
const NOW = Date.parse('2026-10-30T10:00:00.000Z');
const BEGIN = '2026-10-29T10:00:00.000Z';
const UNTIL = '2026-11-29T10:00:00.000Z';
const INPUT = {
  actorId: OWNER,
  novelId: 41,
  episodeId: 11,
  purpose: PURPOSE
};

function grant(processor = 'openai', changes = {}) {
  return {
    processor,
    policy_revision: REVISION,
    granted_at: BEGIN,
    expires_at: UNTIL,
    revoked_at: null,
    ...changes
  };
}

function fixture({
  enabled = true,
  grants = [grant()],
  processors = ['openai'],
  owner = OWNER,
  episodeNovelId = 41,
  failedTable = null,
  policyRevision = REVISION
} = {}) {
  const state = {
    grants,
    queries: [],
    owner,
    episodeNovelId,
    failedTable
  };
  const serviceClient = {
    from(table) {
      const filters = [];
      const builder = {
        select(columns) {
          state.queries.push([table, columns]);
          return this;
        },
        eq(key, value) {
          filters.push([key, value]);
          return this;
        },
        in(key, values) {
          filters.push([key, values]);
          return this;
        },
        async maybeSingle() {
          if (table === state.failedTable) {
            return { data: null, error: { code: 'MISSING' } };
          }
          if (table === 'novels') {
            return { data: { id: 41, user_id: state.owner }, error: null };
          }
          if (table === 'episodes') {
            return {
              data: {
                id: 11,
                novel_id: state.episodeNovelId
              },
              error: null
            };
          }
          throw new Error('Unexpected offline read');
        },
        async limit(n) {
          if (table === state.failedTable) {
            return { data: null, error: { code: 'MISSING' } };
          }
          assert.equal(table, 'novelight_ai_external_processing_consents');
          assert.equal(n, processors.length + 1);
          assert.deepEqual(filters.slice(0, 3), [
            ['actor_id', OWNER],
            ['novel_id', 41],
            ['purpose', PURPOSE]
          ]);
          assert.deepEqual(filters[3], ['processor', [...new Set(processors)]]);
          return { data: state.grants, error: null };
        }
      };
      return builder;
    }
  };
  const routes = {
    'novel-bible': processors.map((provider) => ({
      provider,
      model: 'offline-metadata-only'
    }))
  };
  const check = createOwnerNovelBibleConsentPermissionCheck({
    enabled,
    ownerId: OWNER,
    serviceClient,
    routes,
    policyRevision,
    now: () => NOW
  });
  return { state, check };
}

test('no processing consent is inferred when the gate is OFF', async () => {
  const { state, check } = fixture({ enabled: false });
  assert.equal(await check(INPUT), false);
  assert.equal(state.queries.length, 0);
});

test('requires trusted owner, purpose, novel and episode IDs', async () => {
  const { state, check } = fixture();
  for (const update of [
    { actorId: OTHER },
    { purpose: 'other-purpose' },
    { novelId: 0 },
    { novelId: '41' },
    { episodeId: 0 },
    { episodeId: 42.5 }
  ]) {
    assert.equal(await check({ ...INPUT, ...update }), false);
  }
  assert.equal(state.queries.length, 0);
});

test('a current explicitly scoped grant allows only that owner and work', async () => {
  const { state, check } = fixture();
  assert.equal(await check(INPUT), true);
  assert.equal(state.queries.length, 3);
});

test('no grants, revoked grants and expired terms all deny', async () => {
  const { state, check } = fixture();
  const invalid = [
    [],
    [grant('openai', { revoked_at: '2026-10-30T09:00:00.000Z' })],
    [grant('openai', { expires_at: '2026-10-30T09:00:00.000Z' })],
    [grant('openai', { granted_at: '2026-10-31T00:00:00.000Z' })],
    [grant('openai', { policy_revision: 'outdated-terms-v1' })],
    [grant('openai', { expires_at: null })],
    [grant('openai', { revoked_at: undefined })],
    [grant('openai', { granted_at: 'not-a-date' })],
    [grant('openai'), grant('openai')]
  ];
  for (const grants of invalid) {
    state.grants = grants;
    assert.equal(await check(INPUT), false);
  }
});

test('every possible fallback processor must have a separate valid grant', async () => {
  const { state, check } = fixture({
    processors: ['openai', 'gemini'],
    grants: [grant('openai')]
  });
  assert.equal(await check(INPUT), false);
  state.grants = [grant('openai'), grant('gemini')];
  assert.equal(await check(INPUT), true);
  state.grants = [
    grant('openai'),
    grant('gemini', { policy_revision: 'outdated-terms-v1' })
  ];
  assert.equal(await check(INPUT), false);
});

test('revocation is visible on the next request without a stale consent cache', async () => {
  const { state, check } = fixture();
  assert.equal(await check(INPUT), true);
  state.grants = [grant('openai', { revoked_at: '2026-10-30T09:10:00.000Z' })];
  assert.equal(await check(INPUT), false);
  assert.equal(state.queries.length, 6);
});

test('foreign ownership, moved chapters and missing DB table deny', async () => {
  const { state, check } = fixture();
  state.owner = OTHER;
  assert.equal(await check(INPUT), false);
  state.owner = OWNER;
  state.episodeNovelId = 99;
  assert.equal(await check(INPUT), false);
  state.episodeNovelId = 41;
  state.failedTable = 'novelight_ai_external_processing_consents';
  assert.equal(await check(INPUT), false);
});

test('configuration rejects unknown models, processor or invalid policy', () => {
  const invalidConfigs = [
    { processors: ['local'] },
    { processors: ['openai', 'gemini', 'openai'] },
    { processors: [] },
    { policyRevision: 'v1' }
  ];
  for (const options of invalidConfigs) {
    assert.throws(() => fixture(options), /AI_CONSENT_GATE_UNAVAILABLE/u);
  }
});

test('proposed consent SQL is review-only, RLS-on and not a migration', async () => {
  const sql = await readFile(
    new URL(
      '../reports/sql/novelight_ai_external_consent_PROPOSAL.sql',
      import.meta.url
    ),
    'utf8'
  );
  assert.match(sql, /REVIEW PROPOSAL ONLY/u);
  assert.match(sql, /enable row level security/u);
  assert.match(sql, /from public, anon, authenticated/u);
  assert.match(sql, /primary key \(actor_id, novel_id, purpose, processor\)/u);
  assert.match(sql, /rollback;/u);
  assert.doesNotMatch(sql, /security definer/u);
});
