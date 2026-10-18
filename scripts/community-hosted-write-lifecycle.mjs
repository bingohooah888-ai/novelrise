// Isolated hosted browser proof lifecycle. Not an approval authority or CLI.
// Only a trusted OWNER-led, exact-SHA workflow may supply the execution grant
// and privileged adapters. No credentials or external calls live in this file.
import { inspectCommunityHostedWritePreparation } from './community-hosted-write-preparation.mjs';

export const HOSTED_WRITE_SCOPE = 'community-phase1-hosted-authenticated-write';
const COUNTERS = Object.freeze([
  'comments',
  'reactions',
  'reports',
  'notifications',
  'hiddenPosts',
  'restrictions',
  'testUsers'
]);
// The browser adapter must return a run-bound assertion receipt; merely
// completing without throwing is NOT evidence that any check was performed.
// These booleans are an internal contract, not independent authentication.
const REQUIRED_BROWSER_ASSERTIONS = Object.freeze([
  'twoIndependentUserSessions',
  'separateAdminSession',
  'anonymousAccessDenied',
  'crossUserBlockMuteVerified',
  'ownerOptInRevokeVerified',
  'likesCommentsReportsNotificationsVerified',
  'adminModerationAuditVerified',
  'r15R18PrivateUnpublishedRpcExcluded'
]);
const ACTIONS = Object.freeze([
  'getSnapshot',
  'openGate',
  'runBrowser',
  'closeGate',
  'revokeSessions',
  'removeFixtureRows',
  'removeTestUsers',
  'destroyIsolatedBranch',
  'confirmBranchDeleted'
]);

function deny(reason) {
  throw new Error('COMMUNITY_HOSTED_LIFECYCLE_DENIED: ' + reason);
}

function assertCleanSnapshot(snapshot) {
  if (!snapshot || snapshot.publicEnabled !== false) {
    deny('public gate is not verifiably OFF');
  }
  for (const key of COUNTERS) {
    if (snapshot[key] !== 0) {
      deny('test data is not verifiably absent: ' + key);
    }
  }
}

function assertBrowserProof(proof, grant, target) {
  if (
    proof?.status !== 'COMMUNITY_HOSTED_BROWSER_ASSERTIONS_COMPLETE' ||
    proof.mainSha !== target.mainSha ||
    proof.candidateSha !== target.candidateSha ||
    proof.requestCommentId !== String(grant.requestCommentId) ||
    proof.runId !== String(grant.runId) ||
    proof.projectRef !== target.isolatedProjectRef ||
    proof.previewOrigin !== target.previewOrigin ||
    proof.productionMutationObserved !== false ||
    !proof.userIds ||
    ['author', 'reader', 'admin'].some(
      (role) => proof.userIds[role] !== target.userIds[role]
    ) ||
    REQUIRED_BROWSER_ASSERTIONS.some((name) => proof[name] !== true)
  ) {
    deny('browser assertions missing or not bound to exact isolated run');
  }
}

function checkInputs({ grant, target, actions }) {
  if (
    grant?.status !== 'AUTHORIZED_BY_TRUSTED_MAIN_WORKFLOW' ||
    grant?.runAuthorized !== true ||
    grant?.writeAuthorized !== true ||
    grant?.scope !== HOSTED_WRITE_SCOPE ||
    !/^[1-9][0-9]*$/u.test(String(grant?.requestCommentId || '')) ||
    !/^[1-9][0-9]*$/u.test(String(grant?.runId || ''))
  ) {
    deny('missing independent trusted OWNER execution authorization');
  }
  const preparation = inspectCommunityHostedWritePreparation(target);
  if (
    grant.mainSha !== target.mainSha ||
    grant.candidateSha !== target.candidateSha ||
    grant.projectRef !== preparation.isolatedProjectRef ||
    grant.previewOrigin !== target.previewOrigin
  ) {
    deny('execution grant does not match immutable isolated target');
  }
  if (!actions || ACTIONS.some((name) => typeof actions[name] !== 'function')) {
    deny('mandatory cleanup, rollback and deletion adapters are incomplete');
  }
}

// The executor must obtain its grant from a separate authenticated, single-use
// OWNER ledger gate. This lifecycle never converts preparation into authority.
export async function runCommunityHostedWriteLifecycle({
  grant,
  target,
  actions
}) {
  checkInputs({ grant, target, actions });
  const failures = [];
  let browserVerified = false;
  let initial;
  let initialRead = false;
  try {
    initial = await actions.getSnapshot();
    initialRead = true;
  } catch {
    // Provisioning may already have succeeded before snapshot access failed.
    // Never open the gate; still attempt every cleanup and branch deletion.
    failures.push('initial_snapshot_unavailable');
  }
  let initialClean = false;
  if (initialRead) {
    try {
      assertCleanSnapshot(initial);
      initialClean = true;
    } catch {
      // Do not open the gate or delete rows/users from a dirty baseline.
      // Still run the exact run-owned isolated-branch disposal adapter.
      failures.push('dirty_initial_snapshot');
    }
  }

  try {
    if (initialClean) {
      // Gate opening may partially succeed before it throws: always clean up.
      await actions.openGate();
      const proof = await actions.runBrowser();
      assertBrowserProof(proof, grant, target);
      browserVerified = true;
    }
  } catch {
    failures.push('browser_or_gate');
  } finally {
    // Never short-circuit cleanup after a failure. No raw exception text or
    // credentials should be copied into audit output.
    const cleanup = [
      ['close_gate', () => actions.closeGate()],
      ...(!initialRead || initialClean
        ? [
            ['revoke_sessions', () => actions.revokeSessions()],
            ['remove_fixture_rows', () => actions.removeFixtureRows()],
            ['remove_test_users', () => actions.removeTestUsers()]
          ]
        : [])
    ];
    for (const [name, operation] of cleanup) {
      try {
        await operation();
      } catch {
        failures.push(name);
      }
    }
    if (!initialRead || initialClean) {
      try {
        assertCleanSnapshot(await actions.getSnapshot());
      } catch {
        failures.push('committed_state_postcheck');
      }
    }
    try {
      // The adapter must independently verify exact run-owned branch identity
      // before deleting it. A dirty baseline never authorizes row deletion.
      await actions.destroyIsolatedBranch();
    } catch {
      failures.push('destroy_branch');
    }
    try {
      if ((await actions.confirmBranchDeleted()) !== true) {
        failures.push('branch_deletion_postcheck');
      }
    } catch {
      failures.push('branch_deletion_postcheck');
    }
  }
  if (failures.length) {
    deny('verification/cleanup incomplete: ' + failures.join(','));
  }
  return Object.freeze({
    status: 'BROWSER_VERIFIED_AND_BRANCH_DISPOSED',
    browserVerified,
    cleanupVerified: true,
    mainSha: target.mainSha,
    candidateSha: target.candidateSha,
    requestCommentId: String(grant.requestCommentId),
    runId: String(grant.runId)
  });
}
