// Offline review only. Never authenticates an OWNER, contacts GitHub,
// acquires a lock, reads credentials, posts comments, or touches a database.
const inert = (status, fields) =>
  Object.freeze({
    status,
    ...fields,
    authoritative: false,
    mayReadStagingSecrets: false,
    mayWriteStaging: false,
    mayExecuteSql: false,
    mayPostClaim: false,
    mayPostConsumed: false,
    mayMergeMain: false,
    mayDeploy: false
  });

function jobSection(source, job) {
  if (typeof source !== 'string') return null;
  const lines = source.split(/\r?\n/u);
  const starts = lines
    .map((line, index) => (line === `  ${job}:` ? index : -1))
    .filter((index) => index >= 0);
  if (starts.length !== 1) return null;
  const from = starts[0] + 1;
  const next = lines.findIndex(
    (line, index) => index >= from && /^  [a-z][a-z0-9_-]*:\s*$/u.test(line)
  );
  return lines.slice(from, next < 0 ? undefined : next).join('\n');
}

function exactlyOneGroup(section, indent) {
  if (typeof section !== 'string') return null;
  const pattern = new RegExp(
    `^${' '.repeat(indent)}group:\\s*([a-z0-9_-]+)\\s*$`,
    'gmu'
  );
  const matches = [...section.matchAll(pattern)];
  return matches.length === 1 ? matches[0][1] : null;
}

/**
 * Structural audit of current Draft workflows; does NOT prove real concurrency.
 * A GitHub Actions concurrency group is neither an atomic CAS register
 * nor a durable FIFO queue and cannot authenticate a GitHub Issue comment.
 */
export function inspectScoutPoint10xLockTopology({
  existingWorkflow,
  inertBlueprint
} = {}) {
  const oldAdmit = exactlyOneGroup(jobSection(existingWorkflow, 'admit'), 6);
  const oldStage = exactlyOneGroup(jobSection(existingWorkflow, 'stage'), 6);
  const planGroup = exactlyOneGroup(inertBlueprint, 2);
  const blockers = [];
  if (!oldAdmit || !oldStage || !planGroup)
    blockers.push('workflow_mutex_parse_unverifiable');
  if (oldAdmit && oldStage && oldAdmit !== oldStage)
    blockers.push('old_admit_and_stage_mutex_differ');
  if (planGroup && oldStage && planGroup !== oldStage)
    blockers.push('inert_mutex_differs_from_staging_mutex');
  if (planGroup && oldAdmit && planGroup !== oldAdmit)
    blockers.push('inert_mutex_differs_from_admission_mutex');
  blockers.push('issue_comments_are_not_atomic_cas');
  blockers.push('github_actions_concurrency_is_not_durable_fifo');
  blockers.push('trusted_main_full_scope_serialization_not_proven');
  return inert('cross_workflow_serialization_unproven', {
    mutexes: Object.freeze({
      oldAdmit,
      oldStage,
      inertProposed: planGroup
    }),
    blockers: Object.freeze(blockers),
    oldWorkflowEdited: false,
    blueprintActivated: false,
    approvalConsumed: false
  });
}

const ACTIONS = Object.freeze(['scan', 'append', 'verify']);

/**
 * Enumerates all order-preserving interleavings of two Issue-comment clients.
 * The only modeled shared resource is an append-only claim list. A scan has no
 * transactional guard, so two scans can both see an empty list before posting.
 * Ideal serialization is a counterfactual model, NOT an acquired real lock.
 */
export function simulateScoutPoint10xClaimRace({
  idealSerialization = false
} = {}) {
  if (typeof idealSerialization !== 'boolean')
    return inert('invalid_race_model_input', {
      blockers: Object.freeze(['invalid_serialization_assumption'])
    });

  const witnesses = [];
  let schedulesChecked = 0;
  const step = (positions, scans, claims, events) => {
    if (positions[0] === ACTIONS.length && positions[1] === ACTIONS.length) {
      schedulesChecked += 1;
      if (claims.length > 1) witnesses.push(Object.freeze([...events]));
      return;
    }
    for (const runner of [0, 1]) {
      if (positions[runner] === ACTIONS.length) continue;
      // Under the ideal serial assumption, a runner keeps the lock until
      // its three operations end; this must not be assumed for real Actions.
      if (idealSerialization) {
        const other = 1 - runner;
        if (positions[other] > 0 && positions[other] < ACTIONS.length) continue;
      }
      const action = ACTIONS[positions[runner]];
      const nextPositions = [...positions];
      const nextScans = [...scans];
      const nextClaims = [...claims];
      nextPositions[runner] += 1;
      if (action === 'scan') nextScans[runner] = claims.length === 0;
      if (action === 'append' && scans[runner])
        nextClaims.push(runner === 0 ? 'A' : 'B');
      step(nextPositions, nextScans, nextClaims, [
        ...events,
        `${runner === 0 ? 'A' : 'B'}.${action}`
      ]);
    }
  };
  step([0, 0], [false, false], [], []);
  return inert('offline_race_model_not_live_proof', {
    model: idealSerialization
      ? 'hypothetical_perfect_serialization'
      : 'unserialized',
    schedulesChecked,
    doubleClaimScheduleCount: witnesses.length,
    possibleDoubleClaim: witnesses.length > 0,
    firstCounterexample: Object.freeze(witnesses[0] || []),
    guaranteesRealLock: false,
    guaranteesDurableQueue: false,
    guaranteesClaimPersistence: false,
    proofOfOwnerAuthentication: false
  });
}
