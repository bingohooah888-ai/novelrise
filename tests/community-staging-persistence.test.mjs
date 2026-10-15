import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  assertCommunityPersistentAdmission,
  COMMUNITY_PREFIX
} from '../scripts/community-staging-persistent-approval.mjs';
import { composeCommunityPersistentSQL } from '../scripts/community-staging-transaction.mjs';

const mainSha = 'a'.repeat(40);
const candidateSha = 'b'.repeat(40);

function good() {
  const request = {
    scope: 'community-phase1-persist',
    mainSha,
    candidateSha,
    migration: '20261014052000',
    confirmation: 'STAGING APPROVED'
  };
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
      body: COMMUNITY_PREFIX + JSON.stringify(request)
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

test('persistent admission requires OWNER and matching SHAs', () => {
  const input = good();
  const result = assertCommunityPersistentAdmission(input);
  assert.equal(result.candidateSha, candidateSha);

  input.comment.author_association = 'MEMBER';
  assert.throws(() => assertCommunityPersistentAdmission(input), /OWNER/u);

  input.comment.author_association = 'OWNER';
  input.main.object.sha = 'c'.repeat(40);
  assert.throws(() => assertCommunityPersistentAdmission(input), /drift/u);
});

test('persistent approval is separate from rollback and cannot replay', () => {
  const input = good();
  const claim = {
    requestCommentId: '90210',
    mainSha,
    candidateSha,
    runId: '77'
  };
  const body = 'NOVELIGHT_STAGING_COMMUNITY_PERSIST_CLAIMED ';
  input.ledgerPages = [[{ body: body + JSON.stringify(claim) }]];
  assert.throws(
    () => assertCommunityPersistentAdmission(input),
    /already claimed/u
  );

  input.ledgerPages = [[]];
  input.comment.body = input.comment.body.replace(
    'community-phase1-persist',
    'community-phase1-isolated'
  );
  assert.throws(() => assertCommunityPersistentAdmission(input), /scope/u);
});

test('persistent SQL checks schema and records ledger in one commit', () => {
  const fragments = [
    '\\set ON_ERROR_STOP on\nBEGIN;\nSELECT 1;\nROLLBACK;',
    'BEGIN;\nSELECT 2;\nCOMMIT;',
    'BEGIN;\nSELECT 3;\nROLLBACK;'
  ];
  const sql = composeCommunityPersistentSQL(fragments);
  assert.equal((sql.match(/^BEGIN;$/gmu) ?? []).length, 1);
  assert.equal((sql.match(/^COMMIT;$/gmu) ?? []).length, 1);
  assert.equal((sql.match(/^ROLLBACK;$/gmu) ?? []).length, 0);
  assert.match(sql, /INSERT INTO supabase_migrations\.schema_migrations/u);
  assert.match(sql, /SET LOCAL lock_timeout/u);
  assert.ok(sql.indexOf('SELECT 3;') < sql.indexOf('INSERT INTO'));

  assert.throws(
    () => composeCommunityPersistentSQL([fragments[0]]),
    /exactly three/u
  );
  const injected = [...fragments];
  injected[1] += '\nCOMMIT;';
  assert.throws(
    () => composeCommunityPersistentSQL(injected),
    /exact BEGIN\/closing wrapper/u
  );
});

test('workflow requires dedicated Staging and single-use approval', () => {
  const path = new URL(
    '../.github/workflows/community-staging-persistent-schema.yml',
    import.meta.url
  );
  const yaml = readFileSync(path, 'utf8');
  assert.match(yaml, /author_association == 'OWNER'/u);
  assert.match(yaml, /NOVELIGHT_STAGING_COMMUNITY_PERSIST_APPROVE/u);
  assert.match(yaml, /group: supabase-staging-migration-sync/u);
  assert.match(yaml, /environment: staging/u);
  assert.match(yaml, /manifest-persistent/u);
  assert.match(yaml, /compose-persistent/u);
  assert.match(yaml, /public_enabled::text/u);
  assert.match(yaml, /wmlzjgvxgoyrovdhbqbg/u);
  assert.doesNotMatch(yaml, /workflow_dispatch:/u);
});
