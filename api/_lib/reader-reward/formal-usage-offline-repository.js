// Deterministic in-memory repository for isolated formal-reward development.
// Never import into a live server. This is not PostgreSQL persistence.
// A later approved DB adapter must implement the same transaction boundary.
import {
  quoteScoutXpLevelUp,
  recheckScoutXpLevelUp
} from './xp-progression.js';
import {
  validateScoutLevelStateSnapshot,
  quoteScoutReviewStateTransition,
  recheckScoutReviewProposal
} from './state-transition.js';
import { quoteScoutMaintenanceReviewDryRun } from './maintenance-review.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const copy = (value) => JSON.parse(JSON.stringify(value));

export function createOfflineFormalUsageRepository({
  readers = [],
  budgets = {},
  openingPointEventKeys = [],
  openingEvidence = null
} = {}) {
  if (!Array.isArray(openingPointEventKeys))
    throw new TypeError('Verified opening Point keys required');
  const openingPointKeys = new Set(openingPointEventKeys);
  const users = new Map();
  for (const reader of readers) {
    const userId = reader.userId;
    const balance = reader.availablePoints;
    const eligible = reader.exchangeEligiblePoints;
    if (
      !UUID.test(userId || '') ||
      users.has(userId) ||
      !Number.isSafeInteger(balance) ||
      !Number.isSafeInteger(eligible) ||
      balance < 0 ||
      eligible < 0 ||
      eligible > balance
    ) {
      throw new TypeError('Invalid offline wallet fixture');
    }
    users.set(userId, {
      wallet: {
        userId,
        availablePoints: balance,
        exchangeEligiblePoints: eligible,
        reservedPoints: 0,
        heldPoints: reader.heldPoints || 0,
        revision: 0
      },
      account: copy(reader.account || {}),
      levelState: reader.levelState
        ? validateScoutLevelStateSnapshot(reader.levelState)
        : null,
      history: copy(reader.history || [])
    });
  }

  // A synthetic handoff must carry its original canonical beta entries as
  // well as post-release credits. The source keys are never rewritten.
  const openingByUser = new Map();
  const openingKeys = new Set();
  if (openingEvidence !== null) {
    const canonical = openingEvidence?.canonicalRows;
    const formal = openingEvidence?.formalCredits;
    if (!Array.isArray(canonical) || !Array.isArray(formal))
      throw new TypeError('Complete synthetic opening evidence required');
    for (const entry of [...canonical, ...formal]) {
      if (
        !entry ||
        !UUID.test(entry.userId || '') ||
        !users.has(entry.userId) ||
        typeof entry.eventKey !== 'string' ||
        !entry.eventKey ||
        openingKeys.has(entry.eventKey) ||
        !Number.isSafeInteger(entry.points) ||
        (entry.formal === true && entry.points <= 0) ||
        (entry.formal !== true && entry.status !== 'confirmed')
      )
        throw new TypeError('Invalid or duplicate canonical opening entry');
      openingKeys.add(entry.eventKey);
      const total = openingByUser.get(entry.userId) || {
        all: 0,
        eligible: 0,
        events: 0
      };
      total.all += entry.points;
      if (entry.formal === true) total.eligible += entry.points;
      total.events++;
      if (
        !Number.isSafeInteger(total.all) ||
        !Number.isSafeInteger(total.eligible)
      )
        throw new RangeError('Synthetic opening Point overflow');
      openingByUser.set(entry.userId, total);
    }
    if (
      openingPointKeys.size !== canonical.length ||
      canonical.some((entry) => !openingPointKeys.has(entry.eventKey))
    )
      throw new TypeError('Canonical beta event-key inventory mismatch');
    for (const [userId, user] of users) {
      const sum = openingByUser.get(userId) || { all: 0, eligible: 0 };
      if (
        sum.all !== user.wallet.availablePoints ||
        sum.eligible !== user.wallet.exchangeEligiblePoints
      )
        throw new TypeError('Synthetic opening Wallet ledger mismatch');
    }
  }

  const allowedPurposes = ['external_exchange', 'ai_direct_use'];
  const budgetMap = new Map();
  for (const purpose of allowedPurposes) {
    const row = budgets[purpose];
    if (
      !row ||
      typeof row.scopeId !== 'string' ||
      (row.limitPoints !== null &&
        (!Number.isSafeInteger(row.limitPoints) || row.limitPoints < 0))
    )
      throw new TypeError('Approved offline budget fixture required');
    budgetMap.set(purpose, {
      scopeId: row.scopeId,
      limitPoints: row.limitPoints,
      committedPoints: 0,
      reservedPoints: 0,
      revision: 0
    });
  }
  const operations = new Map();
  const syntheticEarningLedger = new Map();
  const syntheticXpClaims = new Map();
  const syntheticXpGrantKeys = new Set();
  const syntheticMaintenanceClaims = new Map();
  let tail = Promise.resolve();

  // Only the offline fixture may use this synthetic credit writer. It shares
  // the existing in-memory transaction tail with spending, so Wallet and
  // Point history change together with a unique ledger event key.
  async function creditSyntheticEarning({
    userId,
    eventId,
    eventKey,
    points,
    kind,
    at
  } = {}) {
    if (
      !UUID.test(userId || '') ||
      !UUID.test(eventId || '') ||
      typeof eventKey !== 'string' ||
      eventKey.length < 1 ||
      eventKey.length > 240 ||
      !['read', 'comment'].includes(kind) ||
      !Number.isSafeInteger(points) ||
      points < 1 ||
      points > (kind === 'read' ? 11 : 20) ||
      typeof at !== 'string' ||
      !Number.isFinite(Date.parse(at))
    )
      return { status: 'invalid_synthetic_earning' };
    let unlock;
    const next = new Promise((resolve) => {
      unlock = resolve;
    });
    const prior = tail;
    tail = next;
    await prior;
    try {
      const existing = syntheticEarningLedger.get(eventKey);
      if (existing)
        return {
          status:
            existing.userId === userId && existing.eventId === eventId
              ? 'already_recorded'
              : 'synthetic_ledger_conflict'
        };
      const user = users.get(userId);
      if (!user) return { status: 'wallet_unavailable' };
      const available = user.wallet.availablePoints + points;
      const eligible = user.wallet.exchangeEligiblePoints + points;
      if (
        !Number.isSafeInteger(available) ||
        !Number.isSafeInteger(eligible) ||
        eligible > available
      )
        return { status: 'synthetic_point_overflow' };
      user.wallet.availablePoints = available;
      user.wallet.exchangeEligiblePoints = eligible;
      user.wallet.revision++;
      user.history.unshift({
        operationId: eventId,
        kind,
        points,
        status: 'confirmed',
        at
      });
      syntheticEarningLedger.set(eventKey, {
        userId,
        eventId,
        points,
        kind,
        at
      });
      return { status: 'recorded' };
    } finally {
      unlock();
    }
  }

  // Mirror the already committed public.scout_xp_ledger event in memory.
  // The genuine formal SQL cutover performs progression, one-time Point
  // claims and Wallet updates in one transaction. This is ONLY its offline
  // analog and never writes or replays to a real database.
  async function applySyntheticXpEvent({
    verifiedXpLedgerRow: row,
    sourceFixtureVerified,
    requiredXpByLevel
  } = {}) {
    if (
      sourceFixtureVerified !== true ||
      !row ||
      !UUID.test(row.id || '') ||
      !UUID.test(row.user_id || '') ||
      !UUID.test(row.source_event_id || '') ||
      typeof row.xp_kind !== 'string' ||
      !Number.isSafeInteger(row.xp_value) ||
      row.xp_value <= 0 ||
      !Number.isSafeInteger(Date.parse(row.occurred_at))
    )
      return { status: 'canonical_xp_source_invalid' };

    let unlock;
    const next = new Promise((resolve) => {
      unlock = resolve;
    });
    const prior = tail;
    tail = next;
    await prior;
    try {
      const user = users.get(row.user_id);
      if (!user?.levelState) return { status: 'formal_state_missing' };
      if (syntheticXpClaims.has(row.id)) return { status: 'already_applied' };
      const state = user.levelState;
      const grant = {
        userId: row.user_id,
        sourceEventId: row.source_event_id,
        xpKind: row.xp_kind,
        earnedXp: row.xp_value,
        occurredAtMs: Date.parse(row.occurred_at)
      };
      let proposal;
      try {
        proposal = quoteScoutXpLevelUp({
          stateSnapshot: state,
          xpEvent: grant,
          evidenceComplete: true,
          alreadyAppliedToProgress: false,
          thresholdsApproved: true,
          requiredXpByLevel
        });
      } catch {
        return { status: 'xp_quote_invalid' };
      }
      if (proposal.status !== 'proposal_only')
        return { status: proposal.status };
      if (syntheticXpGrantKeys.has(proposal.grantKey))
        return { status: 'already_applied' };
      // Match the dormant SQL's unresolved Lv.100 surplus policy.
      if (state.currentLevel === 100)
        return { status: 'level_100_surplus_policy_pending' };
      if (proposal.nextState.currentLevel === 100) {
        const toCap = Object.keys(requiredXpByLevel)
          .filter((level) => Number(level) >= state.currentLevel)
          .reduce((sum, level) => sum + requiredXpByLevel[level], 0);
        if (row.xp_value + state.levelProgressXp > toCap)
          return { status: 'level_100_surplus_policy_pending' };
      }
      const recheck = recheckScoutXpLevelUp({
        proposal,
        currentStateSnapshot: state,
        grantKeyAlreadyCommitted: false
      });
      if (recheck.status !== 'preconditions_match_only')
        return { status: recheck.status };

      const gained = proposal.levelsGained;
      const firstLevels = gained.filter((level) => {
        const key = 'level_up:' + row.user_id + ':' + level;
        return (
          level > state.highestLevel &&
          !openingPointKeys.has(key) &&
          !syntheticEarningLedger.has(key)
        );
      });
      const awardedPoints = firstLevels.length * 50;
      const nextAvailable = user.wallet.availablePoints + awardedPoints;
      const nextEligible = user.wallet.exchangeEligiblePoints + awardedPoints;
      const nextPeriodXp = user.account.earnedXpInPeriod + row.xp_value;
      if (
        ![nextAvailable, nextEligible, nextPeriodXp].every(
          Number.isSafeInteger
        ) ||
        nextEligible > nextAvailable
      )
        return { status: 'synthetic_xp_overflow' };
      const nextUser = copy(user);
      nextUser.levelState = proposal.nextState;
      nextUser.account.level = proposal.nextState.currentLevel;
      nextUser.account.highestLevel = proposal.nextState.highestLevel;
      nextUser.account.progressXp = proposal.nextState.levelProgressXp;
      nextUser.account.requiredXp =
        proposal.nextState.currentLevel === 100
          ? null
          : requiredXpByLevel[proposal.nextState.currentLevel];
      nextUser.account.earnedXpInPeriod = nextPeriodXp;
      nextUser.wallet.availablePoints = nextAvailable;
      nextUser.wallet.exchangeEligiblePoints = nextEligible;
      if (awardedPoints) nextUser.wallet.revision++;
      for (const level of firstLevels) {
        nextUser.history.unshift({
          operationId: row.id + ':level:' + level,
          kind: 'level_up',
          points: 50,
          status: 'confirmed',
          at: row.occurred_at
        });
      }
      // Single in-memory commit: XP claim + Level + Point ledger + Wallet
      // and history must either ALL change or remain untouched.
      users.set(row.user_id, nextUser);
      syntheticXpClaims.set(row.id, {
        xpLedgerId: row.id,
        userId: row.user_id,
        xpKind: row.xp_kind,
        points: row.xp_value,
        at: row.occurred_at,
        grantKey: proposal.grantKey
      });
      syntheticXpGrantKeys.add(proposal.grantKey);
      for (const level of firstLevels) {
        syntheticEarningLedger.set('level_up:' + row.user_id + ':' + level, {
          userId: row.user_id,
          eventId: row.id,
          points: 50,
          kind: 'level_up',
          level,
          at: row.occurred_at
        });
      }
      return {
        status: 'applied',
        level: proposal.nextState.currentLevel,
        progressXp: proposal.nextState.levelProgressXp,
        levelsGained: gained,
        firstLevelsRewarded: firstLevels,
        pointsAwarded: awardedPoints
      };
    } finally {
      unlock();
    }
  }

  // OFFLINE counterpart of the existing private review_scout_30_days RPC.
  // Serializes against XP application and Wallet spending via the SAME tail.
  // Snapshot completeness must be checked by the synthetic source fixture.
  async function reviewSyntheticMaintenance({
    userId,
    asOfMs,
    verifiedLedgerRows,
    ledgerSnapshotComplete,
    requiredXpByLevel
  } = {}) {
    if (
      !UUID.test(userId || '') ||
      !Number.isSafeInteger(asOfMs) ||
      asOfMs < 0 ||
      !Array.isArray(verifiedLedgerRows)
    )
      return { status: 'review_request_invalid' };
    let unlock;
    const next = new Promise((resolve) => {
      unlock = resolve;
    });
    const prior = tail;
    tail = next;
    await prior;
    try {
      const user = users.get(userId);
      if (!user?.levelState) return { status: 'formal_state_missing' };
      const state = user.levelState;
      const last = state.lastReviewedWindowEndMs;
      const ordinal =
        last === null ? 1 : 1 + (last - state.reviewAnchorMs) / (30 * 86400000);
      if (!Number.isSafeInteger(ordinal) || ordinal < 1)
        return { status: 'review_checkpoint_invalid' };
      let quote;
      try {
        quote = quoteScoutMaintenanceReviewDryRun({
          accountId: userId,
          firstWindowStartMs: state.reviewAnchorMs,
          reviewOrdinal: ordinal,
          asOfMs,
          lastReviewedWindowEndMs: last,
          ledgerSnapshotComplete,
          verifiedLedgerRows,
          currentLevel: state.currentLevel,
          verifiedHistoricalMaxLevel: state.highestLevel,
          currentLevelProgressXp: state.levelProgressXp
        });
      } catch {
        return { status: 'review_evidence_invalid' };
      }
      if (quote.status !== 'quotation_only') return { status: quote.status };
      let proposal;
      try {
        proposal = quoteScoutReviewStateTransition({
          stateSnapshot: state,
          reviewQuote: quote
        });
      } catch {
        return { status: 'review_transition_invalid' };
      }
      if (proposal.status !== 'proposal_only')
        return { status: proposal.status };
      const recheck = recheckScoutReviewProposal({
        proposal,
        currentStateSnapshot: state,
        reviewKeyAlreadyCommitted: syntheticMaintenanceClaims.has(
          proposal.reviewKey
        )
      });
      if (recheck.status !== 'preconditions_match_only')
        return { status: recheck.status };
      const nextLevel = proposal.nextState.currentLevel;
      const nextUser = copy(user);
      nextUser.levelState = proposal.nextState;
      nextUser.account.level = nextLevel;
      nextUser.account.highestLevel = proposal.nextState.highestLevel;
      nextUser.account.progressXp = proposal.nextState.levelProgressXp;
      nextUser.account.requiredXp =
        nextLevel === 100 ? null : requiredXpByLevel[nextLevel];
      // A review starts a new 30-day interval. The complete XP ledger still
      // retains all earned XP in the closed interval for audit.
      nextUser.account.earnedXpInPeriod = 0;
      nextUser.account.nextMaintenanceAt = new Date(
        quote.windowEndMs + 30 * 86400000
      ).toISOString();
      // Review NEVER credits/debits Point: preserve Wallet revision/history.
      users.set(userId, nextUser);
      syntheticMaintenanceClaims.set(proposal.reviewKey, {
        userId,
        windowStartMs: quote.windowStartMs,
        windowEndMs: quote.windowEndMs,
        earnedXp: quote.earnedXpInCompleted30DayWindow,
        demoted: nextLevel < state.currentLevel,
        levelBefore: state.currentLevel,
        levelAfter: nextLevel
      });
      return {
        status: 'reviewed',
        reviewOrdinal: quote.reviewOrdinal,
        windowStartMs: quote.windowStartMs,
        windowEndMs: quote.windowEndMs,
        earnedXp: quote.earnedXpInCompleted30DayWindow,
        demoted: nextLevel < state.currentLevel,
        level: nextLevel
      };
    } finally {
      unlock();
    }
  }

  async function transact(userId, callback) {
    if (!users.has(userId)) return { status: 'wallet_unavailable' };
    let unlock;
    const next = new Promise((resolve) => {
      unlock = resolve;
    });
    const prior = tail;
    tail = next;
    await prior;
    try {
      // Global serialization protects the shared budget as well as wallets.
      // A real DB implementation must lock both, not merely the user row.
      const localUsers = new Map(
        [...users].map(([id, state]) => [id, copy(state)])
      );
      const localBudgets = new Map(
        [...budgetMap].map(([id, state]) => [id, copy(state)])
      );
      const localOps = new Map(
        [...operations].map(([id, state]) => [id, copy(state)])
      );
      const tx = {
        getWallet(id) {
          return copy(localUsers.get(id)?.wallet ?? null);
        },
        getBudget(purpose) {
          return copy(localBudgets.get(purpose) ?? null);
        },
        getOperation(id) {
          return copy(localOps.get(id) ?? null);
        },
        save({ wallet, budget, operation }) {
          const user = localUsers.get(operation.userId);
          if (
            !user ||
            user.wallet.userId !== wallet.userId ||
            !localBudgets.has(operation.purpose)
          )
            throw new Error('OFFLINE_TRANSACTION_INVALID');
          const priorOp = localOps.get(operation.operationId);
          user.wallet = { ...user.wallet, ...copy(wallet) };
          localBudgets.set(operation.purpose, copy(budget));
          localOps.set(operation.operationId, copy(operation));
          const record = user.history.find(
            (entry) => entry.operationId === operation.operationId
          );
          if (!priorOp) {
            user.history.unshift({
              operationId: operation.operationId,
              kind: operation.purpose === 'ai_direct_use' ? 'ai' : 'exchange',
              points: -operation.amountPoints,
              status: 'pending',
              at: 'offline-development-only'
            });
          } else if (record) {
            record.status =
              operation.phase === 'committed'
                ? 'confirmed'
                : operation.phase === 'released'
                  ? 'cancelled'
                  : operation.phase === 'refunded'
                    ? 'refunded'
                    : 'pending';
            if (operation.phase === 'refunded') {
              user.history.unshift({
                operationId: operation.operationId + ':refund',
                kind: 'refund',
                points: operation.amountPoints,
                status: 'confirmed',
                at: 'offline-development-only'
              });
            }
          }
        }
      };
      const result = await callback(tx);
      // Persist only successful callback completion; throw = full rollback.
      users.clear();
      for (const [id, state] of localUsers) users.set(id, state);
      budgetMap.clear();
      for (const [id, state] of localBudgets) budgetMap.set(id, state);
      operations.clear();
      for (const [id, state] of localOps) operations.set(id, state);
      return result;
    } finally {
      unlock();
    }
  }

  return Object.freeze({
    transact,
    creditSyntheticEarning,
    applySyntheticXpEvent,
    reviewSyntheticMaintenance,
    async getSyntheticLevelState(userId) {
      return copy(users.get(userId)?.levelState ?? null);
    },
    getSyntheticMaintenanceSummary() {
      return [...syntheticMaintenanceClaims.values()].map(copy);
    },
    getSyntheticXpSummary() {
      return {
        applied: [...syntheticXpClaims.values()].map(copy),
        levelRewards: [...syntheticEarningLedger.values()]
          .filter((row) => row.kind === 'level_up')
          .map(copy)
      };
    },
    // Aggregate-only counterpart to the existing canonical Wallet cohort
    // inspector. It independently re-sums immutable opening entries, later
    // unique Point claims, and settled/reserved operations. No identifiers
    // leave this method, and the inspector still blocks real activation.
    getSyntheticWalletCohortAggregate() {
      if (openingEvidence === null)
        throw new Error('SYNTHETIC_OPENING_EVIDENCE_REQUIRED');
      const values = {
        population_users: users.size,
        wallet_users: users.size,
        ledger_users: 0,
        ledger_without_wallet_users: 0,
        wallet_without_ledger_users: 0,
        wallet_balance_mismatch_users: 0,
        eligible_exceeds_available_users: 0,
        negative_ledger_users: 0,
        unsettled_ledger_users: 0,
        unsettled_ledger_rows: 0,
        held_wallet_users: 0,
        wallet_available_points: 0,
        wallet_reserved_points: 0,
        wallet_eligible_points: 0,
        ledger_confirmed_net_points: 0
      };
      for (const [id, state] of users) {
        const opening = openingByUser.get(id) || {
          all: 0,
          eligible: 0,
          events: 0
        };
        const awarded = [...syntheticEarningLedger.values()]
          .filter((entry) => entry.userId === id)
          .reduce((total, entry) => total + entry.points, 0);
        const reserved = [...operations.values()].filter(
          (op) => op.userId === id && op.phase === 'reserved'
        );
        const committed = [...operations.values()].filter(
          (op) => op.userId === id && op.phase === 'committed'
        );
        const pendingSum = reserved.reduce(
          (total, op) => total + op.amountPoints,
          0
        );
        const spent = committed.reduce(
          (total, op) => total + op.amountPoints,
          0
        );
        const eligibleUsed = [...reserved, ...committed].reduce(
          (total, op) => total + op.eligibleReservedPoints,
          0
        );
        const canonicalNet = opening.all + awarded - spent;
        const expectedAvailable = canonicalNet - pendingSum;
        const expectedEligible = opening.eligible + awarded - eligibleUsed;
        const history = state.history.map((entry) => entry.operationId);
        if (
          !Number.isSafeInteger(canonicalNet) ||
          !Number.isSafeInteger(expectedAvailable) ||
          !Number.isSafeInteger(expectedEligible)
        )
          throw new RangeError('Synthetic cohort reconciliation overflow');
        const ledgerExists =
          opening.events > 0 || awarded > 0 || committed.length > 0;
        if (ledgerExists) values.ledger_users++;
        else values.wallet_without_ledger_users++;
        const duplicateHistory = new Set(history).size !== history.length;
        if (
          expectedAvailable !== state.wallet.availablePoints ||
          pendingSum !== state.wallet.reservedPoints ||
          expectedEligible !== state.wallet.exchangeEligiblePoints ||
          duplicateHistory
        )
          values.wallet_balance_mismatch_users++;
        if (
          state.wallet.exchangeEligiblePoints < 0 ||
          state.wallet.exchangeEligiblePoints > state.wallet.availablePoints
        )
          values.eligible_exceeds_available_users++;
        if (canonicalNet < 0) values.negative_ledger_users++;
        if (reserved.length) values.unsettled_ledger_users++;
        values.unsettled_ledger_rows += reserved.length;
        if (state.wallet.heldPoints > 0) values.held_wallet_users++;
        values.wallet_available_points += state.wallet.availablePoints;
        values.wallet_reserved_points += state.wallet.reservedPoints;
        values.wallet_eligible_points += state.wallet.exchangeEligiblePoints;
        values.ledger_confirmed_net_points += canonicalNet;
      }
      if (Object.values(values).some((v) => !Number.isSafeInteger(v)))
        throw new RangeError('Synthetic cohort aggregate overflow');
      return values;
    },
    getSyntheticUsageTotals() {
      const settled = [...operations.values()].filter(
        (operation) => operation.phase === 'committed'
      );
      return {
        giftSpentNet: settled
          .filter((operation) => operation.purpose === 'external_exchange')
          .reduce((sum, operation) => sum + operation.amountPoints, 0),
        aiSpentNet: settled
          .filter((operation) => operation.purpose === 'ai_direct_use')
          .reduce((sum, operation) => sum + operation.amountPoints, 0)
      };
    },
    async readReader(userId) {
      const s = users.get(userId);
      if (!s) return null;
      return copy({
        wallet: {
          ...s.wallet,
          heldPoints: s.wallet.heldPoints + s.wallet.reservedPoints
        },
        account: s.account,
        history: s.history
      });
    },
    async findOperation(operationId) {
      return copy(operations.get(operationId) ?? null);
    },
    async listPendingExchanges() {
      return [...operations.values()]
        .filter(
          (op) => op.purpose === 'external_exchange' && op.phase === 'reserved'
        )
        .map(copy);
    },
    async listRefundCandidates() {
      return [...operations.values()]
        .filter((op) => op.phase === 'committed')
        .map(copy);
    }
  });
}
