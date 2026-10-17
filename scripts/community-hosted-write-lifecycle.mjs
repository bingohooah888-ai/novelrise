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
  const initial = await actions.getSnapshot();
  assertCleanSnapshot(initial);

  const failures = [];
  let browserVerified = false;
  try {
    // Gate opening may partially succeed before it throws: always clean up.
    await actions.openGate();
    await actions.runBrowser();
    browserVerified = true;
  } catch {
    failures.push('browser_or_gate');
  } finally {
    // Never short-circuit cleanup after a failure. No raw exception text or
    // credentials should be copied into audit output.
    const cleanup = [
      ['close_gate', () => actions.closeGate()],
      ['revoke_sessions', () => actions.revokeSessions()],
      ['remove_fixture_rows', () => actions.removeFixtureRows()],
      ['remove_test_users', () => actions.removeTestUsers()]
    ];
    for (const [name, operation] of cleanup) {
      try {
        await operation();
      } catch {
        failures.push(name);
      }
    }
    try {
      assertCleanSnapshot(await actions.getSnapshot());
    } catch {
      failures.push('committed_state_postcheck');
    }
    try {
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
    requestCommentId: String(grant.requestCommentId)
  });
}
