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

test('all structural checks still return preparation-only and no authorization', () => {
  const result = inspect();
  assert.equal(result.status, 'PREPARATION_ONLY');
  assert.equal(result.writeAuthorized, false);
  assert.equal(result.runAuthorized, false);
  assert.equal(result.releaseAuthorized, false);
  assert.deepEqual(result.missingEvidence, [...REQUIRED_HOSTED_PROOFS]);
  assert.ok(Object.isFrozen(result));
});

test('wrong commit revision cannot be used as a hosted test target', () => {
  assert.throws(() => inspect({ previewRevision: 'd'.repeat(40) }), /DENIED/u);
  assert.throws(() => inspect({ mainSha: 'broken' }), /DENIED/u);
  assert.throws(
    () => inspect({ candidateSha: inputs.mainSha }),
    /DENIED/u
  );
});

test('Production and shared Staging resources are always forbidden', () => {
  for (const projectRef of [
    PRODUCTION_PROJECT_REF,
    EXISTING_SHARED_STAGING_REF
  ]) {
    assert.throws(
      () =>
        inspect({
          isolatedProjectRef: projectRef,
          supabaseOrigin: `https://${projectRef}.supabase.co`
        }),
      /DENIED/u
    );
  }
  assert.throws(
    () => inspect({ previewOrigin: 'https://novelrise.vercel.app' }),
    /DENIED/u
  );
  assert.throws(
    () => inspect({ previewOrigin: 'https://novelight.jp' }),
    /DENIED/u
  );
});

test('inconsistent and unsafe origins are rejected', () => {
  assert.throws(
    () => inspect({ supabaseOrigin: 'https://dddddddddddddddddddd.supabase.co' }),
    /DENIED/u
  );
  assert.throws(
    () =>
      inspect({
        previewOrigin: 'https://community-preview-test.vercel.app.evil.com'
      }),
    /DENIED/u
  );
  assert.throws(
    () => inspect({ previewOrigin: 'https://name:secret@demo.vercel.app' }),
    /DENIED/u
  );
  assert.throws(
    () => inspect({ supabaseOrigin: 'http://cccccccccccccccccccc.supabase.co' }),
    /DENIED/u
  );
});

test('synthetic author, reader and admin identities must remain separate', () => {
  assert.throws(() => inspect({ userIds: undefined }), /DENIED/u);
  assert.throws(
    () =>
      inspect({
        userIds: { ...inputs.userIds, admin: inputs.userIds.reader }
      }),
    /DENIED/u
  );
  assert.throws(
    () =>
      inspect({
        userIds: { ...inputs.userIds, author: 'not-a-uuid' }
      }),
    /DENIED/u
  );
});
