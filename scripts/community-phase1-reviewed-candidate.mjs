import { readFileSync } from 'node:fs';

const SHA = /^[a-f0-9]{40}$/u;

// Reviewed Phase 1 PR #2222 file content, not a fixed PR HEAD.
// Exact file set+blobs remain unchanged when main-only safety fixes are merged.
// Any change to this manifest requires a separately reviewed trusted-main PR.
export const REVIEWED_COMMUNITY_FILES = Object.freeze(
  [
    {
      "path": "admin-community.html",
      "sha": "b90560c57113d7e27f92715a55685a6391c7f59f",
      "status": "added"
    },
    {
      "path": "api/_lib/admin-community.js",
      "sha": "3a3a4ce8b46f41fd3f33159d0d4f79d9af53be42",
      "status": "added"
    },
    {
      "path": "api/admin-community.js",
      "sha": "2e43211b5b2d6b1674313059c0912af107763c3a",
      "status": "added"
    },
    {
      "path": "auth-reader-context.js",
      "sha": "aa7b56e218373f3f47caaa4e8b34880249b6ddb9",
      "status": "modified"
    },
    {
      "path": "author-notes.html",
      "sha": "c6e28d122f323ce8544c5ffeb8596795f6d0ec22",
      "status": "modified"
    },
    {
      "path": "community.html",
      "sha": "74ce2b544deef6de2413b723a23dd67ef672b10b",
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
      "sha": "fb359b60a7a20ab948f9b82c9dd89e4c4b820834",
      "status": "added"
    },
    {
      "path": "docs/DOCUMENT-SOURCE-OF-TRUTH.md",
      "sha": "0b6b225315be2eb7d0ea8a2be37351302198189a",
      "status": "modified"
    },
    {
      "path": "index.html",
      "sha": "fcef7b7c3e0392d9ccd82dbfec0fdd899fba509c",
      "status": "modified"
    },
    {
      "path": "light-seed-history.html",
      "sha": "49c5e4ab426e70750abdca070d09e3a3c29252ac",
      "status": "modified"
    },
    {
      "path": "novelight-client.js",
      "sha": "f753236d30f9b5376a0060ba2ec2ad2dcf23e79a",
      "status": "modified"
    },
    {
      "path": "novelight-community-alerts.js",
      "sha": "bb0e379514c3351777773e38393c3557b0659aa8",
      "status": "added"
    },
    {
      "path": "novelight-community-config.js",
      "sha": "edefc63df53af401063f66819262a2b986b58090",
      "status": "added"
    },
    {
      "path": "novelight-community.css",
      "sha": "668d5edd9273268341c074d0ac251768c659afbe",
      "status": "added"
    },
    {
      "path": "novelight-community.js",
      "sha": "938946b0370fd05f51a27a2686b520617455751b",
      "status": "added"
    },
    {
      "path": "scripts/community-staging-candidate-contract.mjs",
      "sha": "344f3bf1c159b05428fbd5add750b2caabedc1ab",
      "status": "added"
    },
    {
      "path": "scripts/community-staging-preflight.mjs",
      "sha": "a3ad5844897d85af9ee40d84a282b035a5dce05b",
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
      "sha": "1e99763224b61233ec8b58226e08336d7ac7ec20",
      "status": "added"
    },
    {
      "path": "supabase/checks/20261014052000_community_plaza_phase1_postrollback.sql",
      "sha": "8f92fe4d6da2ee4ad42415bb8a3b9ec3a2371fc7",
      "status": "added"
    },
    {
      "path": "supabase/checks/20261014052000_community_plaza_phase1_precheck.sql",
      "sha": "cc6f0bdd4dcff975852d99018c88dac02abd93bb",
      "status": "added"
    },
    {
      "path": "supabase/migrations/20261014052000_community_plaza_phase1.sql",
      "sha": "df651446da99e299005b4c8ec262c528bf477922",
      "status": "added"
    },
    {
      "path": "supabase/rollback/20261014052000_community_plaza_phase1_rollback.sql",
      "sha": "c6f41da90aece8df16d1d3d967507b3e5914e7cb",
      "status": "added"
    },
    {
      "path": "tests/accessibility-baseline.test.mjs",
      "sha": "ff4d22ab2c3fb54d63f99d5ba069edc7ae647e86",
      "status": "modified"
    },
    {
      "path": "tests/community-plaza-contract.test.mjs",
      "sha": "47d924d00413c5338fc2b7985f80149c85548b8c",
      "status": "added"
    },
    {
      "path": "tests/community-staging-candidate-contract.test.mjs",
      "sha": "23cdf4780d8dc15885f82d69a44ab638fd458a24",
      "status": "added"
    },
    {
      "path": "tests/community-staging-forward-reconcile.test.mjs",
      "sha": "43aee4fafb30e3d69a60dcceeac15d2916766db2",
      "status": "added"
    },
    {
      "path": "tests/community-staging-preflight.test.mjs",
      "sha": "8c7721c3df45a9619501c394a718a94916c7ea1d",
      "status": "added"
    },
    {
      "path": "tests/e2e/specs/async-ui.spec.js",
      "sha": "24c5759d4c1238d4f59a2dda1a4b9a1f80bf0ecd",
      "status": "modified"
    },
    {
      "path": "tests/e2e/specs/community-admin-ui.js",
      "sha": "19a9e9a43cc4fa55f2d5ef629e77765054b85d24",
      "status": "added"
    },
    {
      "path": "tests/e2e/specs/community-plaza-ui.js",
      "sha": "90924558498bb54f07580426f51b3aa86e8012e8",
      "status": "added"
    },
    {
      "path": "tests/e2e/specs/smoke.spec.js",
      "sha": "5e9f8ad9cf9e238f908207896826d09dc6c6e346",
      "status": "modified"
    },
    {
      "path": "tests/rls/community-plaza-phase1-behavior.sql",
      "sha": "c95f2254c1c90cd84b67d410e96b5335f427b3cd",
      "status": "added"
    },
    {
      "path": "tests/rls/community-plaza-phase1-security.sql",
      "sha": "45b70546a7dc9853769f49389ed6df712c9a52b1",
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
