import { readFileSync } from 'node:fs';

const SHA = /^[a-f0-9]{40}$/u;

// Reviewed Phase 1 PR #2222 file content, not a fixed PR HEAD.
// Exact file set+blobs remain unchanged when main-only safety fixes are merged.
// Any change to this manifest requires a separately reviewed trusted-main PR.
export const REVIEWED_COMMUNITY_FILES = Object.freeze(
  [
    {
      "path": "admin-community.html",
      "sha": "a2eeda861ca56409932d6e832ac8567c2aef1753",
      "status": "added"
    },
    {
      "path": "api/_lib/admin-community.js",
      "sha": "84647957d25d8b5591dfc7abfa58c5c1b922a510",
      "status": "added"
    },
    {
      "path": "api/admin-community.js",
      "sha": "2e43211b5b2d6b1674313059c0912af107763c3a",
      "status": "added"
    },
    {
      "path": "author-notes.html",
      "sha": "c6e28d122f323ce8544c5ffeb8596795f6d0ec22",
      "status": "modified"
    },
    {
      "path": "community.html",
      "sha": "bc1c5243c3f1fd902096983cbeddc56662c970b0",
      "status": "added"
    },
    {
      "path": "curation-lists.html",
      "sha": "5c21090e36753d60fc4baa7e617c940abc19ff72",
      "status": "modified"
    },
    {
      "path": "docs/COMMUNITY-PHASE1-DB-REVIEW-DRAFT.sql",
      "sha": "9890215710cff48c54bff1d98f5c622b832e5f53",
      "status": "added"
    },
    {
      "path": "docs/COMMUNITY-PLAZA-PHASE1-HANDOFF.md",
      "sha": "9a1c26cd9a3e69aa001cb8db3330132396e783c4",
      "status": "added"
    },
    {
      "path": "docs/COMMUNITY-STAGING-CANDIDATE-CONTRACT.md",
      "sha": "fc9713f9c55d72bd26c4c0526b685cfdc3d7ab6b",
      "status": "added"
    },
    {
      "path": "docs/COMMUNITY-STAGING-VERIFICATION-ROUTE.md",
      "sha": "41d1974afe8c61806171fc1be6b4d04f3fe87d4c",
      "status": "added"
    },
    {
      "path": "docs/DOCUMENT-SOURCE-OF-TRUTH.md",
      "sha": "20f13881500f5fe18e8d48e0a1c39a91f48fa404",
      "status": "modified"
    },
    {
      "path": "index.html",
      "sha": "7cef83bbaa236c2a9a45ca80020395f75b943d77",
      "status": "modified"
    },
    {
      "path": "light-seed-history.html",
      "sha": "49c5e4ab426e70750abdca070d09e3a3c29252ac",
      "status": "modified"
    },
    {
      "path": "novelight-client.js",
      "sha": "cfdc22837decfeb8e4b9e2396c6e8d9981a7acd4",
      "status": "modified"
    },
    {
      "path": "novelight-community-alerts.js",
      "sha": "4c40ce14c93a7d35735d94918216d0bcf5c2cb57",
      "status": "added"
    },
    {
      "path": "novelight-community-config.js",
      "sha": "edefc63df53af401063f66819262a2b986b58090",
      "status": "added"
    },
    {
      "path": "novelight-community.css",
      "sha": "2cf2fe3c195daea347f0e9f8e40a7fb0d6b72745",
      "status": "added"
    },
    {
      "path": "novelight-community.js",
      "sha": "febf2652faa0cf73be3ad4b6ccc41e5f0816957c",
      "status": "added"
    },
    {
      "path": "scripts/community-staging-candidate-contract.mjs",
      "sha": "344f3bf1c159b05428fbd5add750b2caabedc1ab",
      "status": "added"
    },
    {
      "path": "scripts/community-staging-preflight.mjs",
      "sha": "a6b8a3a3d7a7cfd1f8e00d1a7fac651a2dcbded7",
      "status": "added"
    },
    {
      "path": "scripts/run-migration-replay.sh",
      "sha": "d4e2da48d35f1e10f8485ff5de8b59733f3d7ba7",
      "status": "modified"
    },
    {
      "path": "scripts/run-rls-integration.sh",
      "sha": "310735fbda219366c9983604876583eeae5f07e4",
      "status": "modified"
    },
    {
      "path": "supabase/checks/20261014052000_community_plaza_phase1_postcheck.sql",
      "sha": "b328980f483acfe738ae066dc430dd6d02b63687",
      "status": "added"
    },
    {
      "path": "supabase/checks/20261014052000_community_plaza_phase1_postrollback.sql",
      "sha": "ba701423b4ee97593220ef3b51f149bef3429823",
      "status": "added"
    },
    {
      "path": "supabase/checks/20261014052000_community_plaza_phase1_precheck.sql",
      "sha": "cc6f0bdd4dcff975852d99018c88dac02abd93bb",
      "status": "added"
    },
    {
      "path": "supabase/migrations/20261014052000_community_plaza_phase1.sql",
      "sha": "1f5ef773a4073f10cc2e1b886eb3a8c942beb5c4",
      "status": "added"
    },
    {
      "path": "supabase/rollback/20261014052000_community_plaza_phase1_rollback.sql",
      "sha": "18b96aea8d1618ba65765cbbda01a76eb636e45c",
      "status": "added"
    },
    {
      "path": "tests/accessibility-baseline.test.mjs",
      "sha": "cb72484530f211c56c335b2fe62dcc81e8d9b831",
      "status": "modified"
    },
    {
      "path": "tests/community-plaza-contract.test.mjs",
      "sha": "97edda9e0db093c8e84905148480b30dbd867bae",
      "status": "added"
    },
    {
      "path": "tests/community-staging-candidate-contract.test.mjs",
      "sha": "23cdf4780d8dc15885f82d69a44ab638fd458a24",
      "status": "added"
    },
    {
      "path": "tests/community-staging-preflight.test.mjs",
      "sha": "9b88ebcd81e2936d465519d86a566b90af96c27c",
      "status": "added"
    },
    {
      "path": "tests/e2e/specs/async-ui.spec.js",
      "sha": "477962f8349fcd7f26a498d8df12e315dfc568fb",
      "status": "modified"
    },
    {
      "path": "tests/e2e/specs/community-admin-ui.js",
      "sha": "19a9e9a43cc4fa55f2d5ef629e77765054b85d24",
      "status": "added"
    },
    {
      "path": "tests/e2e/specs/community-plaza-ui.js",
      "sha": "55c45b544c930941e5fab4533c9c399d0cb8c8c0",
      "status": "added"
    },
    {
      "path": "tests/e2e/specs/smoke.spec.js",
      "sha": "5e9f8ad9cf9e238f908207896826d09dc6c6e346",
      "status": "modified"
    },
    {
      "path": "tests/rls/community-plaza-phase1-behavior.sql",
      "sha": "c8a01773489e791c3c9e69bf6b094795a058e122",
      "status": "added"
    },
    {
      "path": "tests/rls/community-plaza-phase1-security.sql",
      "sha": "3503bc992bd7c05a6105f3529ce6764e3b5c862c",
      "status": "added"
    }
  ]
    .map((file) => Object.freeze(file))
);

function deny() {
  throw new Error('COMMUNITY_REVIEWED_CANDIDATE_DENIED');
}

export function assertReviewedCommunityCandidate({
  compare,
  mainSha,
  candidateSha
}) {
  if (
    !SHA.test(mainSha ?? '') ||
    !SHA.test(candidateSha ?? '') ||
    mainSha === candidateSha ||
    compare?.status !== 'ahead' ||
    compare?.behind_by !== 0 ||
    compare?.base_commit?.sha !== mainSha ||
    !Number.isSafeInteger(compare?.total_commits) ||
    compare.total_commits < 1 ||
    compare.total_commits > 250 ||
    compare.ahead_by !== compare.total_commits ||
    !Array.isArray(compare.commits) ||
    compare.commits.length !== compare.total_commits ||
    compare.commits.at(-1)?.sha !== candidateSha ||
    !Array.isArray(compare.files) ||
    compare.files.length !== REVIEWED_COMMUNITY_FILES.length
  ) {
    deny();
  }
  const expected = new Map(REVIEWED_COMMUNITY_FILES.map((f) => [f.path, f]));
  const seen = new Set();
  for (const file of compare.files) {
    if (
      !file ||
      typeof file.filename !== 'string' ||
      seen.has(file.filename) ||
      !expected.has(file.filename)
    ) {
      deny();
    }
    const reviewed = expected.get(file.filename);
    if (file.sha !== reviewed.sha || file.status !== reviewed.status) {
      deny();
    }
    seen.add(file.filename);
  }
  if (seen.size !== REVIEWED_COMMUNITY_FILES.length) deny();
  return Object.freeze({ reviewedFileCount: seen.size, mainSha, candidateSha });
}

if (process.argv[2] === 'verify-compare') {
  try {
    if (process.argv.length !== 6) deny();
    const [mainSha, candidateSha, evidencePath] = process.argv.slice(3);
    const compare = JSON.parse(readFileSync(evidencePath, 'utf8'));
    const proof = assertReviewedCommunityCandidate({ compare, mainSha, candidateSha });
    process.stdout.write(JSON.stringify(proof) + '\n');
  } catch {
    console.error('COMMUNITY_REVIEWED_CANDIDATE_DENIED');
    process.exitCode = 1;
  }
}
