// Immutable Phase 2 review inventory, captured from PR #2457 HEAD
// feb1d7728e4d8cef917df52355d873807eba5cc9. Read-only by design.
// A new feature commit requires fresh human review of all changed blobs.
export const REVIEWED_PHASE2_BLOBS = Object.freeze({
  "supabase/migrations/20261023055617_community_plaza_phase2_board.sql": "898358eaf04aa63003118b5f38492bdf176e95f1",
  "supabase/rollback/20261023055617_community_plaza_phase2_board_rollback.sql": "31e0bed425fecfc83876190acd74f498d5edc682",
  "tests/e2e/staging/community-hosted-auth-write.spec.js": "2df5acd0a7004ed21849511f9593e7853d37b201",
  "tests/e2e/staging/community-hosted-flag-bootstrap.mjs": "9296aa3099853d1bcf2807fb0654de0b8695da45",
  "novelight-client.js": "3107cb02a7f7a8510de1a998a8faee38d3391ebd",
  "novelight-community-board.js": "e7c0e46d68dd1ced3d14c282925331981f87e2a6",
  "tests/rls/community-plaza-phase2-review.sql": "eb383f4d3d91330e0e7cf0d86284d3db0dee25c0",
  "supabase/checks/20261023055617_community_plaza_phase2_precheck.sql": "e1be7c8fbbb1e230519ad33419ed0c5701df549f",
  "supabase/checks/20261023055617_community_plaza_phase2_postcheck.sql": "b50a623dda092849f25b6b71560c5187510a1f3a"
});

const SHA = /^[0-9a-f]{40}$/u;

export function inspectPhase2ReviewedBlobs({ feature, featureCommit, featureTree }) {
  const reasons = [];
  const expectedHead = feature?.head?.sha;
  if (
    !SHA.test(expectedHead ?? '') ||
    featureCommit?.sha !== expectedHead ||
    !SHA.test(featureCommit?.tree?.sha ?? '') ||
    featureTree?.sha !== featureCommit?.tree?.sha
  ) {
    reasons.push('FEATURE_COMMIT_TREE_NOT_VERIFIED');
  }

  if (
    !Array.isArray(featureTree?.tree) ||
    featureTree?.truncated !== false
  ) {
    reasons.push('FEATURE_TREE_TRUNCATED_OR_MISSING');
    return Object.freeze({ valid: false, reasons });
  }

  for (const [path, sha] of Object.entries(REVIEWED_PHASE2_BLOBS)) {
    const matches = featureTree.tree.filter((item) => item.path === path);
    if (
      matches.length !== 1 ||
      matches[0].type !== 'blob' ||
      matches[0].mode !== '100644' ||
      matches[0].sha !== sha
    ) {
      reasons.push('UNREVIEWED_PHASE2_BLOB_' + path);
    }
  }

  return Object.freeze({ valid: reasons.length === 0, reasons });
}
