import assert from 'node:assert/strict';
import test from 'node:test';
// prettier-ignore
import {inspect020705PreviewPrecreation} from
  '../.github/staging-ai-02-07-05/preview-precreation-readonly.mjs';
const SHA = 'a'.repeat(40);
// prettier-ignore
const scope = {
  repository: 'bingohooah888-ai/novelrise',
  stagingProjectRef: 'wmlzjgvxgoyrovdhbqbg',
  mainSha: SHA, branch: 'staging/ai-02-07-05-owner-20261101'
};
// prettier-ignore
const main = {repository: scope.repository, sha: SHA};
// prettier-ignore
test('missing new preview never permits creation or execution', () => {
  const result = inspect020705PreviewPrecreation({
    scope, currentMain: main,
    envMetadata: [{key: 'SUPABASE_URL',
      target: ['preview'], gitBranch: 'staging/ai-02-07-04-old'}]
  });
  assert.equal(result.status, 'NO_CURRENT_SHA_PREVIEW_REQUIRES_STAGING_APPROVAL');
  assert.equal(result.noDeploymentCreated, true);
  assert.equal(result.authorizesPreviewCreation, false);
  assert.equal(result.authorizesStagingWrite, false);
  assert.equal(result.authorizesPaidCall, false);
  assert.equal(result.authorizesRealJwt, false);
  assert.ok(result.missingBranchScopedEnvNames.includes('SUPABASE_URL'));
});
// prettier-ignore
test('matching metadata is still not an authenticated approval', () => {
  const result = inspect020705PreviewPrecreation({
    scope, currentMain: main,
    existingPreview: {
      id: 'dpl_synthetic123', repository: scope.repository,
      projectRef: scope.stagingProjectRef, branch: scope.branch,
      sha: SHA, state: 'READY', target: 'preview'
    }
  });
  assert.equal(result.status, 'PREVIEW_METADATA_MATCHES_REQUIRES_INDEPENDENT_APPROVAL');
  assert.equal(result.authorizesPreviewCreation, false);
});
// prettier-ignore
test('stale Preview cannot be used for current-main paid trial', () => {
  const result = inspect020705PreviewPrecreation({
    scope, currentMain: main,
    existingPreview: {
      id: 'dpl_synthetic123', repository: scope.repository,
      projectRef: scope.stagingProjectRef, branch: scope.branch,
      sha: 'b'.repeat(40), state: 'READY', target: 'preview'
    }
  });
  assert.equal(result.status, 'EXISTING_PREVIEW_SHA_MISMATCH');
});
// prettier-ignore
test('production project, wrong main or invalid preview target fail closed', () => {
  assert.throws(() => inspect020705PreviewPrecreation({
    scope: {...scope, stagingProjectRef: 'fiepaguycecrredwrcwx'},
    currentMain: main
  }), /AI_020705_PREVIEW_PREFLIGHT_DENIED/u);
  assert.throws(() => inspect020705PreviewPrecreation({
    scope, currentMain: {...main, sha: 'b'.repeat(40)}
  }), /AI_020705_PREVIEW_PREFLIGHT_DENIED/u);
  assert.throws(() => inspect020705PreviewPrecreation({
    scope, currentMain: main,
    existingPreview: {
      id: 'dpl_synthetic123', projectRef: scope.stagingProjectRef,
      repository: scope.repository, branch: scope.branch,
      sha: SHA, state: 'READY', target: 'production'
    }
  }), /AI_020705_PREVIEW_PREFLIGHT_DENIED/u);
});
