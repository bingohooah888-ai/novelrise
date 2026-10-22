import assert from 'node:assert/strict';
import test from 'node:test';

import {
  REVIEWED_COMMUNITY_FILES,
  assertReviewedCommunityCandidate
} from '../scripts/community-phase1-reviewed-candidate.mjs';

const MAIN = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const CURRENT_BLOBS = {
  'curation-lists.html': '5c21090e36753d60fc4baa7e617c940abc19ff72',
  'light-seed-history.html': '49c5e4ab426e70750abdca070d09e3a3c29252ac',
  'author-notes.html': 'c6e28d122f323ce8544c5ffeb8596795f6d0ec22',
  'index.html': '3acd9fc20b3f891d94427abc7448ccdcd7cf84b4',
  'tests/accessibility-baseline.test.mjs':
    'ff4d22ab2c3fb54d63f99d5ba069edc7ae647e86',
  'tests/e2e/specs/async-ui.spec.js':
    '24c5759d4c1238d4f59a2dda1a4b9a1f80bf0ecd'
};
const REVIEWED_SMOKE = Object.freeze({
  path: 'tests/e2e/specs/smoke.spec.js',
  previous: 'fc5fa385bb5f285e971367a0c04fa30ff4047126',
  current: '5e9f8ad9cf9e238f908207896826d09dc6c6e346'
});
const PREVIOUS_BLOBS = {
  'tests/e2e/specs/async-ui.spec.js':
    '477962f8349fcd7f26a498d8df12e315dfc568fb',
  'index.html': '7cef83bbaa236c2a9a45ca80020395f75b943d77',
  'tests/accessibility-baseline.test.mjs':
    'cb72484530f211c56c335b2fe62dcc81e8d9b831',
  'author-notes.html': 'b55355a64dcc75225e9a59ff2432fd0e460b46c5',
  'index.html': '104fd490a8326277a6a5f855dae1883064e336a6',
  'tests/accessibility-baseline.test.mjs':
    '7922d5506fddd0567d1e5fd1394d2e698a689a69'
};

function evidence() {
  return {
    mainSha: MAIN,
    candidateSha: HEAD,
    compare: {
      status: 'ahead',
      behind_by: 0,
      ahead_by: 1,
      total_commits: 1,
      base_commit: { sha: MAIN },
      commits: [{ sha: HEAD }],
      files: REVIEWED_COMMUNITY_FILES.map(({ path, status, sha }) => ({
        filename: path,
        status,
        sha
      }))
    }
  };
}

test('only three reviewed integration blobs replace prior fingerprints', () => {
  assert.equal(REVIEWED_COMMUNITY_FILES.length, 37);
  for (const [path, sha] of Object.entries(CURRENT_BLOBS)) {
    const found = REVIEWED_COMMUNITY_FILES.find((x) => x.path === path);
    assert.ok(found);
    assert.equal(found.status, 'modified');
    assert.equal(found.sha, sha);
  }
  assert.equal(
    assertReviewedCommunityCandidate(evidence()).reviewedFileCount,
    37
  );
});

test('current Phase 1 and public-header smoke Git blob is pinned', () => {
  const found = REVIEWED_COMMUNITY_FILES.find(
    (x) => x.path === REVIEWED_SMOKE.path
  );
  assert.ok(found);
  assert.equal(found.status, 'modified');
  assert.equal(found.sha, REVIEWED_SMOKE.current);
  assert.equal(
    assertReviewedCommunityCandidate(evidence()).reviewedFileCount,
    37
  );
  const retired = evidence();
  const oldFile = retired.compare.files.find(
    (x) => x.filename === REVIEWED_SMOKE.path
  );
  assert.ok(oldFile);
  oldFile.sha = REVIEWED_SMOKE.previous;
  assert.throws(
    () => assertReviewedCommunityCandidate(retired),
    /COMMUNITY_REVIEWED_CANDIDATE_DENIED/u
  );
});

test('previous blobs, extra files and divergent ancestry remain denied', () => {
  for (const [path, oldSha] of Object.entries(PREVIOUS_BLOBS)) {
    const input = evidence();
    input.compare.files.find((x) => x.filename === path).sha = oldSha;
    assert.throws(
      () => assertReviewedCommunityCandidate(input),
      /COMMUNITY_REVIEWED_CANDIDATE_DENIED/u
    );
  }
  const extra = evidence();
  extra.compare.files.push({
    filename: 'unreviewed.js',
    sha: 'f'.repeat(40),
    status: 'added'
  });
  assert.throws(
    () => assertReviewedCommunityCandidate(extra),
    /COMMUNITY_REVIEWED_CANDIDATE_DENIED/u
  );
  const behind = evidence();
  behind.compare.behind_by = 1;
  assert.throws(
    () => assertReviewedCommunityCandidate(behind),
    /COMMUNITY_REVIEWED_CANDIDATE_DENIED/u
  );
});
