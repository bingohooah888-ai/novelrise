import assert from 'node:assert/strict';
import test from 'node:test';

import {
  REVIEWED_COMMUNITY_FILES,
  assertReviewedCommunityCandidate
} from '../scripts/community-phase1-reviewed-candidate.mjs';

const MAIN = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const CURRENT_BLOBS = {
  'author-notes.html': '5bd92792238608743d00d4d3eef72862cfcb070b',
  'index.html': '6267de4d01d91839f155af745d1577bb2bbc0395',
  'tests/accessibility-baseline.test.mjs':
    'cb72484530f211c56c335b2fe62dcc81e8d9b831'
};
const PREVIOUS_BLOBS = {
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
  assert.equal(assertReviewedCommunityCandidate(evidence()).reviewedFileCount, 37);
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
