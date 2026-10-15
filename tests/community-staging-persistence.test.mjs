import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  assertCommunityPersistentAdmission,
  COMMUNITY_PREFIX
} from '../scripts/community-staging-persistent-approval.mjs';
import {
  composeCommunityPersistentSQL
} from '../scripts/community-staging-transaction.mjs';

const mainSha = 'a'.repeat(40);
const candidateSha = 'b'.repeat(40);

function good() {
  return {
    repository: 'bingohooah888-ai/novelrise',
    issue: {
      number: 294,
      title: '[Staging Control] Supabase migration sync',
      user: { login: 'bingohooah888-ai' }
    },
    comment: {
      id: 90210,
      user: { login: 'bingohooah888-ai' },
      author_association: 'OWNER',
      body: COMMUNITY_PREFIX + JSON.stringify({
        scope: 'community-phase1-persist',
        mainSha,
        candidateSha,
        migration: '20261014052000',
        confirmation: 'STAGING APPROVED'
      })
    },
    main: { object: { sha: mainSha } },
    pr: {
      number: 2222,
      state: 'open',
      draft: true,
      base: { ref: 'main', sha: mainSha },
      head: { sha: candidateSha }
    },
    compare: {
      status: 'ahead',
      ahead_by: 1,
      behind_by: 0,
      base_commit: { sha: mainSha },
      total_commits: 1,
      commits: [{ sha: candidateSha }]
    },
    ledgerPages: [[]]
  };
}

test('persistent Staging approval needs exact owner, SHA and separate scope', () => {
  const input = good();
  assert.equal(assertCommunityPersistentAdmission(input).candidateSha, candidateSha);
  input.comment.author_association = 'MEMBER';
  assert.throws(() => assertCommunityPersistentAdmission(input), /OWNER/u);
  input.comment.author_association = 'OWNER';
  input.main.object.sha = 'c'.repeat(40);
  assert.throws(() => assertCommunityPersistentAdmission(input), /drift/u);
});

test('persistent ledger consumes each approval once and differs from rollback-only', () => {
  const input = good();
  input.ledgerPages = [[{
    body: 'NOVELIGHT_STAGING_COMMUNITY_PERSIST_CLAIMED ' +
      JSON.stringify({
        requestCommentId: '90210',
        mainSha,
        candidateSha,
        runId: '77'
      })
  }]];
  assert.throws(() => assertCommunityPersistentAdmission(input), /already claimed/u);
  input.ledgerPages = [[]];
  input.comment.body = input.comment.body.replace(
    'community-phase1-persist',
    'community-phase1-isolated'
  );
  assert.throws(() => assertCommunityPersistentAdmission(input), /scope/u);
});

test('pinned precheck, migration, postcheck and ledger write commit atomically', () => {
  const sql = composeCommunityPersistentSQL([
    '\\set ON_ERROR_STOP on\nBEGIN;\nSELECT 1;\nROLLBACK;',
    'BEGIN;\nSELECT 2;\nCOMMIT;',
    'BEGIN;\nSELECT 3;\nROLLBACK;'
  ]);
  assert.equal((sql.match(/^BEGIN;$/gmu) ?? []).length, 1);
  assert.equal((sql.match(/^COMMIT;$/gmu) ?? []).length, 1);
  assert.equal((sql.match(/^ROLLBACK;$/gmu) ?? []).length, 0);
  assert.match(sql, /INSERT INTO supabase_migrations\.schema_migrations/u);
  assert.match(sql, /SET LOCAL lock_timeout/u);
  assert.ok(sql.indexOf('SELECT 3;') < sql.indexOf('INSERT INTO'));
  assert.throws(
    () => composeCommunityPersistentSQL(['BEGIN;\nSELECT 1;\nROLLBACK;']),
    /exactly three/u
  );
  assert.throws(
    () => composeCommunityPersistentSQL([
      'BEGIN;\nSELECT 1;\nROLLBACK;',
      'BEGIN;\nSELECT 2;\nCOMMIT;\nCOMMIT;',
      'BEGIN;\nSELECT 3;\nROLLBACK;'
    ]),
    /exact BEGIN\/closing wrapper/u
  );
});

test('workflow pins Staging, main and one-time persistent approval only', () => {
  const source = readFileSync(
    new URL('../.github/workflows/community-staging-persistent-schema.yml', import.meta.url),
    'utf8'
  );
  assert.match(source, /github\.event\.comment\.author_association == 'OWNER'/u);
  assert.match(source, /NOVELIGHT_STAGING_COMMUNITY_PERSIST_APPROVE/u);
  assert.match(source, /group: supabase-staging-migration-sync/u);
  assert.match(source, /environment: staging/u);
  assert.match(source, /manifest-persistent/u);
  assert.match(source, /compose-persistent/u);
  assert.match(source, /public_enabled::text/u);
  assert.match(source, /wmlzjgvxgoyrovdhbqbg/u);
  assert.doesNotMatch(source, /workflow_dispatch:/u);
});
