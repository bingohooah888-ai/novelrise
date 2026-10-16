import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

import {
  assertCommunityInteractionAdmission,
  CANDIDATE_SHA,
  MIGRATION,
  PREFIX,
  SCOPE
} from '../scripts/community-staging-interaction-admission.mjs';

const mainSha = 'a'.repeat(40);
const commentId = 12345;
const payload = {
  scope: SCOPE,
  mainSha,
  candidateSha: CANDIDATE_SHA,
  migration: MIGRATION,
  confirmation: 'STAGING APPROVED'
};
function admission() {
  return {
    repository: 'bingohooah888-ai/novelrise',
    issue: {
      number: 294,
      title: '[Staging Control] Supabase migration sync',
      user: { login: 'bingohooah888-ai' }
    },
    comment: {
      id: commentId,
      user: { login: 'bingohooah888-ai' },
      author_association: 'OWNER',
      body: PREFIX + JSON.stringify(payload)
    },
    main: { object: { sha: mainSha } },
    ledgerPages: [[]]
  };
}
test('a current one-use OWNER approval binds Staging rollback only', () => {
  const x = admission();
  assert.equal(assertCommunityInteractionAdmission(x).migration, MIGRATION);
  x.comment.author_association = 'CONTRIBUTOR';
  assert.throws(() => assertCommunityInteractionAdmission(x), /DENIED/u);
  x.comment.author_association = 'OWNER';
  x.main.object.sha = 'b'.repeat(40);
  assert.throws(() => assertCommunityInteractionAdmission(x), /DENIED/u);
});
test('claimed or consumed approval cannot be replayed', () => {
  const x = admission();
  for (const verb of ['CLAIMED', 'CONSUMED']) {
    const record = {
      requestCommentId: String(commentId),
      mainSha,
      candidateSha: CANDIDATE_SHA,
      runId: '100'
    };
    if (verb === 'CONSUMED') record.result = 'failure';
    x.ledgerPages = [[{
      body: 'NOVELIGHT_STAGING_COMMUNITY_INTERACTION_' + verb +
        ' ' + JSON.stringify(record)
    }]];
    assert.throws(
      () => assertCommunityInteractionAdmission(x),
      /already been claimed/u
    );
  }
});
test('Staging SQL has single transaction and unconditional ROLLBACK', () => {
  const file = new URL(
    '../supabase/checks/20261016053000_community_phase1_interaction_rollback.sql',
    import.meta.url
  );
  const sql = readFileSync(file, 'utf8');
  assert.equal((sql.match(/^BEGIN;$/gmu) || []).length, 1);
  assert.equal((sql.match(/^ROLLBACK;$/gmu) || []).length, 1);
  assert.equal((sql.match(/^COMMIT;$/gmu) || []).length, 0);
  assert.match(sql, /public_enabled = false/u);
  assert.match(sql, /SET LOCAL ROLE authenticated/u);
  assert.match(sql, /novelight_community_toggle_like/u);
  assert.match(sql, /novelight_community_post_comment/u);
  assert.match(sql, /novelight_community_report/u);
  assert.match(sql, /user_blocks/u);
  assert.match(sql, /user_mutes/u);
  assert.match(sql, /community_hidden_posts/u);
});
test('OWNER-gated trusted workflow never deploys a Preview or alters Production', () => {
  const file = new URL(
    '../.github/workflows/community-staging-interaction-rollback.yml',
    import.meta.url
  );
  const yml = readFileSync(file, 'utf8');
  assert.match(yml, /issue_comment:/u);
  assert.match(yml, /author_association == 'OWNER'/u);
  assert.match(yml, /environment: staging/u);
  assert.match(yml, /STAGING_DATABASE_URL_SOURCE: \$\{\{ secrets.STAGING_DATABASE_URL \}\}/u);
  assert.match(yml, /community-staging-interaction-admission\.mjs validate/u);
  assert.match(yml, /verify-staging-migration-target\.mjs/u);
  assert.match(yml, /if: always\(\)/u);
  assert.match(yml, /test "\$state" = 'false\|1\|0\|0\|0'/u);
  assert.doesNotMatch(yml, /workflow_dispatch:/u);
  assert.doesNotMatch(yml, /vercel-preview-deployment/u);
  assert.doesNotMatch(yml, /supabase db push/u);
});

test('temporary formatter proof for draft CI', () => {
  const output = spawnSync(
    process.execPath,
    [
      'node_modules/prettier/bin/prettier.cjs',
      'tests/community-staging-interaction-rollback.test.mjs'
    ],
    { encoding: 'utf8' }
  );
  if (output.status !== 0) throw new Error(output.stderr);
  console.log('STAGING_PRETTIER_START');
  console.log(output.stdout);
  console.log('STAGING_PRETTIER_END');
});
