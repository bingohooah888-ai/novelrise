import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EXISTING_SHARED_STAGING_REF,
  inspectCommunityHostedWritePreparation,
  PRODUCTION_PROJECT_REF,
  REQUIRED_HOSTED_PROOFS
} from '../scripts/community-hosted-write-preparation.mjs';

const inputs = {
  mainSha: 'a'.repeat(40),
  candidateSha: 'b'.repeat(40),
  previewRevision: 'b'.repeat(40),
  previewOrigin: 'https://community-preview-test.vercel.app',
  supabaseOrigin: 'https://cccccccccccccccccccc.supabase.co',
  isolatedProjectRef: 'cccccccccccccccccccc',
  userIds: {
    author: 'c0a00000-0000-4000-8000-000000000001',
    reader: 'c0a00000-0000-4000-8000-000000000002',
    admin: 'c0a00000-0000-4000-8000-000000000003'
  }
};
const inspect = (changes = {}) =>
  inspectCommunityHostedWritePreparation({ ...inputs, ...changes });

function reject(changes) {
  assert.throws(() => inspect(changes), /DENIED/u);
}

test('structural checks never authorize Staging writes', () => {
  const result = inspect();
  assert.equal(result.status, 'PREPARATION_ONLY');
  assert.equal(result.writeAuthorized, false);
  assert.equal(result.runAuthorized, false);
  assert.equal(result.releaseAuthorized, false);
  assert.deepEqual(result.missingEvidence, [...REQUIRED_HOSTED_PROOFS]);
  assert.ok(Object.isFrozen(result));
});

test('wrong candidate or Preview revision is rejected', () => {
  reject({ previewRevision: 'd'.repeat(40) });
  reject({ mainSha: 'broken' });
  reject({ candidateSha: inputs.mainSha });
});

test('Production and shared Staging resources are forbidden', () => {
  const forbidden = [PRODUCTION_PROJECT_REF, EXISTING_SHARED_STAGING_REF];
  for (const projectRef of forbidden) {
    reject({
      isolatedProjectRef: projectRef,
      supabaseOrigin: `https://${projectRef}.supabase.co`
    });
  }
  reject({ previewOrigin: 'https://novelrise.vercel.app' });
  reject({ previewOrigin: 'https://novelight.jp' });
});

test('invalid or inconsistent origins are rejected', () => {
  reject({ supabaseOrigin: 'https://dddddddddddddddddddd.supabase.co' });
  reject({
    previewOrigin: 'https://community-preview-test.vercel.app.evil.com'
  });
  reject({ previewOrigin: 'https://name:secret@demo.vercel.app' });
  reject({ supabaseOrigin: 'http://cccccccccccccccccccc.supabase.co' });
});

test('three separate synthetic user identities are required', () => {
  reject({ userIds: undefined });
  reject({
    userIds: { ...inputs.userIds, admin: inputs.userIds.reader }
  });
  reject({
    userIds: { ...inputs.userIds, author: 'not-a-uuid' }
  });
});
