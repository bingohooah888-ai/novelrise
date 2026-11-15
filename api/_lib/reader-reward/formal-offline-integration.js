// Node-only, explicitly synthetic end-to-end formal Scout demo.
// Reuses production-shaped service, HTTP factories and original reader UI
// bindings. No connection, task, payment, AI provider or live Point grant.
import { createOfflineFormalUsageRepository } from './formal-usage-offline-repository.js';
import { createUnregisteredFormalRewardHost } from './formal-usage-host.js';
import { reconcileScoutOfflineOpening } from './formal-cutover-offline.js';
import { compileApprovedScoutFormalXpLadder } from './formal-thresholds.js';
import {
  quoteFormalReadPointReward,
  quoteFormalCommentPointReward
} from './formal-earning-rewards.js';
import { reviewFormalEpisodeComment } from './formal-comment-eligibility.js';
import { createFormalOfflineDurableDb } from './formal-offline-durable-db.js';
import { createFormalEarningRunner } from './formal-earning-runner.js';
import { createUnregisteredFormalMaintenanceRunner } from './formal-maintenance-runner.js';
import { createFormalCanonicalSourceReader } from './formal-earning-source-reader.js';
import { createUnregisteredFormalBadgeHistoryInspector } from './formal-badge-history-inspector.js';
import { createUnregisteredFormalWalletCohortInspector } from './formal-wallet-cohort-inspector.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const safe = (n) => Number.isSafeInteger(n) && n >= 0;
const policyApproved = Object.freeze({
  budget: true,
  eligibility: true,
  risk: true,
  channel: true,
  aiPrice: true
});
const copy = (v) => JSON.parse(JSON.stringify(v));

// Exercise the existing read-only badge history inspector against explicitly
// supplied synthetic badge states and ORIGINAL canonical beta Point units.
// A missing Point claim is reported, never minted or backfilled.
function syntheticBadgeHistorySource(handoff, readerIds, badges) {
  if (badges === null) return null;
  if (!Array.isArray(badges) || badges.length > 100)
    throw new TypeError('Bounded synthetic badge history required');
  const byKey = new Map();
  const claims = new Map(
    handoff.convertedRows
      .filter((entry) => entry.pointKind === 'badge')
      .map((entry) => [entry.eventKey, entry])
  );
  const counts = {
    earned_badges: 0,
    linked_events: 0,
    earned_without_event: 0,
    current_unit_events: 0,
    legacy_unit_events: 0,
    anomalous_events: 0,
    event_without_earned_status: 0
  };
  for (const badge of badges) {
    if (
      !badge ||
      !readerIds.has(badge.userId) ||
      !/^reader_[a-z0-9_]+$/.test(badge.badgeId || '') ||
      !['earned', 'in_progress', 'revoked'].includes(badge.status) ||
      !safe(badge.pointReward) ||
      badge.sourceFixtureVerified !== true
    )
      throw new TypeError('Verified synthetic reader badge row required');
    const key = 'badge:' + badge.userId + ':' + badge.badgeId;
    if (byKey.has(key))
      throw new TypeError('Duplicate synthetic reader badge identity');
    byKey.set(key, badge);
    const claim = claims.get(key);
    if (badge.status === 'earned') counts.earned_badges++;
    if (!claim) {
      if (badge.status === 'earned' && badge.pointReward > 0)
        counts.earned_without_event++;
      continue;
    }
    counts.linked_events++;
    if (badge.status !== 'earned') counts.event_without_earned_status++;
    if (
      claim.status !== 'confirmed' ||
      claim.userId !== badge.userId ||
      claim.pointKind !== 'badge'
    )
      counts.anomalous_events++;
    else if (claim.sourceValue === badge.pointReward)
      counts.current_unit_events++;
    else if (
      claim.sourceValue * 10 === badge.pointReward &&
      claim.sourceValue !== badge.pointReward
    )
      counts.legacy_unit_events++;
    else counts.anomalous_events++;
  }
  const unmatched = [...claims.values()].filter(
    (entry) => !byKey.has(entry.eventKey)
  ).length;
  const orphans = {
    unclassified_badge_events: unmatched,
    orphan_reader_badge_events: unmatched
  };
  return createUnregisteredFormalBadgeHistoryInspector({
    query: async (sql) => ({
      rows: [sql.includes('from public.user_scout_badges b') ? counts : orphans]
    })
  });
}

export function createFormalOfflineIntegration({
  handoff,
  betaThresholdRows,
  operatorId,
  mockBudgets,
  mockAiCatalog = [],
  syntheticPostReleasePoints = [],
  syntheticEligibleEvents = [],
  syntheticDurableEvents = [],
  syntheticXpEvents = [],
  syntheticBadgeHistory = null,
  syntheticNowIso,
  formalReleaseAtMs
} = {}) {
  const openingCheck =
    handoff?.status === 'offline_handoff_quote_only'
      ? reconcileScoutOfflineOpening({
          handoff,
          convertedLedgerRows: handoff.convertedRows
        }).status
      : 'handoff_missing';
  if (
    handoff?.status !== 'offline_handoff_quote_only' ||
    openingCheck !== 'offline_opening_reconciled' ||
    !UUID.test(operatorId || '') ||
    !Array.isArray(mockAiCatalog) ||
    !Array.isArray(syntheticPostReleasePoints) ||
    !Array.isArray(syntheticEligibleEvents) ||
    !Array.isArray(syntheticDurableEvents) ||
    !Array.isArray(syntheticXpEvents) ||
    (syntheticBadgeHistory !== null && !Array.isArray(syntheticBadgeHistory)) ||
    syntheticEligibleEvents.length > 100 ||
    syntheticXpEvents.length > 100 ||
    syntheticDurableEvents.length > 100 ||
    ((syntheticDurableEvents.length > 0 || syntheticXpEvents.length > 0) &&
      (syntheticPostReleasePoints.length > 0 ||
        syntheticEligibleEvents.length > 0 ||
        typeof syntheticNowIso !== 'string' ||
        !Number.isFinite(Date.parse(syntheticNowIso)))) ||
    ((syntheticEligibleEvents.length > 0 ||
      syntheticDurableEvents.length > 0 ||
      syntheticXpEvents.length > 0) &&
      (!Number.isSafeInteger(formalReleaseAtMs) || formalReleaseAtMs < 0))
  )
    throw new TypeError(
      'Complete synthetic release fixture required: ' + openingCheck
    );
  if (handoff.walletSeeds.some((s) => s.userId === operatorId))
    throw new TypeError('Synthetic operator cannot be a reader fixture');
  const readerIds = new Set(handoff.walletSeeds.map((s) => s.userId));
  const badgeHistory = syntheticBadgeHistorySource(
    handoff,
    readerIds,
    syntheticBadgeHistory
  );
  const ladder = compileApprovedScoutFormalXpLadder({ betaThresholdRows });
  const formalAddition = new Map();
  for (const e of syntheticPostReleasePoints) {
    if (
      !e ||
      !UUID.test(e.userId || '') ||
      !readerIds.has(e.userId) ||
      !safe(e.amountPoints) ||
      e.amountPoints === 0 ||
      typeof e.eventId !== 'string' ||
      !/^offline-formal:[a-z0-9_-]{1,80}$/.test(e.eventId) ||
      formalAddition.has(e.eventId)
    )
      throw new TypeError('Invalid synthetic reward event');
    formalAddition.set(e.eventId, copy(e));
  }

  // Synthetic-only committed-event bridge. The same reviewed comment and
  // canonical read quotation functions used by the formal earning contract
  // calculate the rewards; arbitrary client-supplied amounts are not accepted.
  // The unique Point event key, not the delivery attempt, prevents replay.
  // This is NOT a database writer and cannot be mounted as a public route.
  const awardedKeys = new Set(handoff.convertedRows.map((row) => row.eventKey));
  const monthlyClaims = new Map();
  const rewardDecisions = [];
  for (const event of syntheticEligibleEvents) {
    if (
      !event ||
      !['read', 'comment'].includes(event.kind) ||
      !UUID.test(event.userId || '') ||
      !readerIds.has(event.userId)
    )
      throw new TypeError('Invalid synthetic canonical reward fixture');

    let verdict;
    if (event.kind === 'read') {
      verdict = quoteFormalReadPointReward({
        userId: event.userId,
        verifiedReadEvent: event.verifiedReadEvent,
        verifiedScoutLevel: event.verifiedScoutLevel,
        verifiedReadTimeLevelEvidence: event.verifiedReadTimeLevelEvidence,
        formalReleaseAtMs,
        evidenceVerified: event.sourceFixtureVerified === true,
        ledgerHistoryComplete: true,
        existingLedgerEventKeys: [...awardedKeys]
      });
    } else {
      const moderation = reviewFormalEpisodeComment({
        comment: event.verifiedComment,
        priorUserComments: event.verifiedPriorUserComments,
        trustedSourceVerified: event.sourceFixtureVerified === true,
        reviewerDecision: event.reviewerDecision,
        reviewerRule: event.reviewerRule
      });
      if (moderation.mayAward !== true) {
        rewardDecisions.push(
          Object.freeze({
            kind: event.kind,
            sourceEventId: event.verifiedComment?.id ?? null,
            status: moderation.status,
            points: 0
          })
        );
        continue;
      }
      // The 50-comment cap must be counted from the accepted synthetic
      // claims in this complete fixture, never a browser-supplied counter.
      // Arbitrary synthetic Point seeds have no verified comment claim count.
      if (syntheticPostReleasePoints.length)
        throw new TypeError(
          'Mixed synthetic comment history is not verifiable'
        );
      const occurred = Date.parse(event.verifiedComment?.created_at);
      const month = Number.isFinite(occurred)
        ? new Date(occurred + 9 * 60 * 60 * 1000).toISOString().slice(0, 7)
        : null;
      const countKey = event.userId + ':' + month;
      verdict = quoteFormalCommentPointReward({
        userId: event.userId,
        verifiedComment: event.verifiedComment,
        verifiedCommentReadEvent: event.verifiedCommentReadEvent,
        verifiedNovelAuthorId: event.verifiedNovelAuthorId,
        formalReleaseAtMs,
        evidenceVerified: event.sourceFixtureVerified === true,
        commentPolicyApprovedAndEligible: true,
        verifiedPolicyMonth: month,
        policyMonthVerified: month !== null,
        verifiedCommentInsidePolicyMonth: month !== null,
        verifiedRewardedCommentsInMonth: monthlyClaims.get(countKey) ?? 0,
        ledgerHistoryComplete: true,
        existingLedgerEventKeys: [...awardedKeys]
      });
      if (verdict.status === 'reward_quote_only')
        monthlyClaims.set(countKey, (monthlyClaims.get(countKey) ?? 0) + 1);
    }
    rewardDecisions.push(
      Object.freeze({
        kind: event.kind,
        sourceEventId:
          verdict.sourceEventId ??
          event.verifiedReadEvent?.id ??
          event.verifiedComment?.id ??
          null,
        status: verdict.status,
        points: verdict.status === 'reward_quote_only' ? verdict.points : 0
      })
    );
    if (verdict.status !== 'reward_quote_only') continue;
    if (awardedKeys.has(verdict.eventKey))
      throw new Error('Synthetic Point event key collision');
    awardedKeys.add(verdict.eventKey);
    const awardId =
      'offline-formal:' +
      event.kind +
      '-' +
      verdict.sourceEventId.toLowerCase();
    if (formalAddition.has(awardId))
      throw new Error('Synthetic Point event ID collision');
    formalAddition.set(awardId, {
      eventId: awardId,
      userId: event.userId,
      kind: event.kind,
      eventKey: verdict.eventKey,
      amountPoints: verdict.points
    });
  }

  const opening = handoff.walletSeeds.map((s) => {
    const additions = [...formalAddition.values()].filter(
      (e) => e.userId === s.userId
    );
    const formal = additions.reduce((sum, e) => sum + e.amountPoints, 0);
    if (!safe(formal) || !safe(s.availablePoints + formal))
      throw new RangeError('Synthetic reward amount overflow');
    const level = s.formalState.currentLevel;
    return {
      userId: s.userId,
      availablePoints: s.availablePoints + formal,
      exchangeEligiblePoints: formal,
      levelState: s.formalState,
      account: {
        level,
        highestLevel: s.formalState.highestLevel,
        progressXp: s.formalState.levelProgressXp,
        requiredXp: level === 100 ? null : ladder.requiredXpByLevel[level],
        earnedXpInPeriod: 0,
        maintenanceXpTarget: 200,
        nextMaintenanceAt: new Date(
          s.firstMaintenanceReviewDueAtMs
        ).toISOString()
      },
      history: [
        ...additions.map((e) => ({
          operationId: e.eventId,
          kind: e.kind || 'reward',
          points: e.amountPoints,
          status: 'confirmed',
          at: 'offline-synthetic-only'
        })),
        ...handoff.convertedRows
          .filter((r) => r.userId === s.userId)
          .map((r) => ({
            operationId: r.id,
            kind: 'reward',
            points: r.convertedValue,
            status: r.status,
            at: 'offline-synthetic-only'
          }))
      ]
    };
  });
  if (!opening.length) throw new TypeError('Synthetic account list required');
  const repository = createOfflineFormalUsageRepository({
    readers: opening,
    budgets: mockBudgets,
    openingPointEventKeys: handoff.convertedRows.map((row) => row.eventKey),
    openingEvidence: {
      canonicalRows: handoff.convertedRows.map((row) => ({
        userId: row.userId,
        eventKey: row.eventKey,
        points: row.convertedValue,
        status: row.status,
        formal: false
      })),
      formalCredits: [...formalAddition.values()].map((entry) => ({
        userId: entry.userId,
        eventKey: entry.eventKey || 'offline-formal-credit:' + entry.eventId,
        points: entry.amountPoints,
        formal: true
      }))
    }
  });
  // Exercise the real unregistered runner, canonical source reader and
  // fixed private SQL call shapes against a synthetic DB. Unlike the legacy
  // up-front quote preview, these awards enter Wallet only after the durable
  // claim, delivery and completion steps have actually been invoked.
  const syntheticDb =
    syntheticDurableEvents.length > 0 || syntheticXpEvents.length > 0
      ? createFormalOfflineDurableDb({
          events: syntheticDurableEvents,
          xpEvents: syntheticXpEvents,
          readerIds,
          operatorId,
          releaseAtMs: formalReleaseAtMs,
          nowIso: syntheticNowIso,
          repository,
          legacyEventKeys: handoff.convertedRows.map((row) => row.eventKey),
          syntheticThresholds: ladder.requiredXpByLevel
        })
      : null;
  const earningRunner = syntheticDb
    ? createFormalEarningRunner({
        postgresClient: syntheticDb,
        releaseTimestampIso: new Date(formalReleaseAtMs).toISOString(),
        launchConfiguration: {
          formalEarningsEnabled: true,
          productionCutoverApproved: true,
          formalWorkerEnabled: true
        },
        trustedServerAuthorization: {
          serviceRoleVerified: true,
          verifiedByTrustedServer: true
        },
        verifyModeratorReceipt: syntheticDb.verifyModeratorReceipt
      })
    : null;
  const maintenanceRunner =
    syntheticDb && syntheticXpEvents.length
      ? createUnregisteredFormalMaintenanceRunner({
          postgresClient: syntheticDb,
          launchConfiguration: {
            formalMaintenanceReviewEnabled: true,
            formalMaintenanceSchedulerEnabled: true,
            productionCutoverApproved: true
          },
          trustedServerAuthorization: {
            serviceRoleVerified: true,
            verifiedByTrustedServer: true
          },
          now: () => new Date(syntheticNowIso)
        })
      : null;
  const sourceInspector = syntheticDb
    ? createFormalCanonicalSourceReader({ postgresClient: syntheticDb })
    : null;

  const walletCohort = createUnregisteredFormalWalletCohortInspector({
    query: async () => ({
      rows: [repository.getSyntheticWalletCohortAggregate()]
    })
  });
  const mockProviderState = new Map();
  let aiInvocations = 0;
  let giftVerifications = 0;
  const catalog = mockAiCatalog.map((f) => ({ ...f }));
  const aiUse = async ({ userId, featureId, maximumPoints }) => {
    aiInvocations += 1;
    const feature = catalog.find((f) => f.id === featureId);
    if (
      !feature ||
      feature.approved !== true ||
      feature.pricePoints !== maximumPoints ||
      !opening.some((s) => s.userId === userId)
    )
      return { status: 'not_executed' };
    // No real model calls or generated output in this simulation.
    return { status: 'succeeded', costPoints: maximumPoints, mock: true };
  };
  const supabase = {
    auth: {
      async getUser(token) {
        const user =
          typeof token === 'string' && token.startsWith('mock:')
            ? token.slice(5)
            : null;
        const found = user === operatorId || readerIds.has(user);
        return {
          data: {
            user: found ? { id: user, email: 'offline@example.invalid' } : null
          },
          error: found ? null : new Error('NOT_AUTHENTICATED')
        };
      }
    }
  };
  const host = createUnregisteredFormalRewardHost({
    repository,
    supabase,
    releaseConfiguration: {
      formalRewardsEnabled: true,
      productionCutoverApproved: true
    },
    trustedServerAuthorization: {
      verifiedByTrustedServer: true,
      serviceRoleVerified: true
    },
    env: { NOVELIGHT_ADMIN_USER_IDS: operatorId },
    inspectEarningSource: sourceInspector?.load,
    getAdminRewardOverview: syntheticDb?.getAdminRewardOverview,
    getAdminBadgeHistory: badgeHistory?.inspect,
    getAdminWalletCohort: walletCohort.inspect,
    catalog,
    policy: {
      giftProviderReady: true,
      verifyExchange: async () => policyApproved,
      verifyAi: async () => policyApproved
    },
    aiExecutor: aiUse,
    verifyGiftReceipt: async ({ operation }) => {
      giftVerifications += 1;
      return mockProviderState.get(operation.operationId) === 'fulfilled';
    },
    verifyGiftNonFulfillment: async ({ operation }) =>
      mockProviderState.get(operation.operationId) === 'not_fulfilled',
    verifyGiftRefund: async ({ operation }) =>
      mockProviderState.get(operation.operationId) === 'recovered',
    verifyAiRefund: async ({ operation }) =>
      mockProviderState.get(operation.operationId) === 'ai_reversed'
  });
  const dispatch = async (handler, user, { method, body, query } = {}) => {
    if (!UUID.test(user || ''))
      throw new TypeError('Synthetic authenticated identity required');
    const req = {
      method: method || 'GET',
      body,
      query,
      headers: {
        authorization: '***' + user,
        origin: 'https://novelight.jp',
        host: 'novelight.jp',
        'x-forwarded-proto': 'https',
        'sec-fetch-site': 'same-origin'
      }
    };
    const res = {
      statusCode: 200,
      result: null,
      headers: {},
      setHeader(k, v) {
        this.headers[k] = v;
      },
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        this.result = data;
        return this;
      }
    };
    await handler(req, res);
    return copy({ statusCode: res.statusCode, body: res.result });
  };
  return Object.freeze({
    mode: 'offline_synthetic_only',
    noRealPointOrProvider: true,
    handoffSummary: handoff.summary,
    rewardDecisions: Object.freeze(rewardDecisions),
    // The existing admin-only GET views receive these aggregate-only
    // read-only inspectors; no beta ledger write or reward re-issue.
    inspectSyntheticWalletCohort: walletCohort.inspect,
    inspectSyntheticBadgeHistory: badgeHistory?.inspect,
    // Match the dormant public.scout_xp_ledger AFTER INSERT handoff with a
    // synthetic source ID, not caller-supplied XP/Level/Point amounts.
    applyCommittedXp: ({ xpLedgerId } = {}) =>
      syntheticDb
        ? syntheticDb.applyCommittedXp({
            xpLedgerId,
            requiredXpByLevel: ladder.requiredXpByLevel
          })
        : { status: 'formal_xp_disabled' },
    // Reuse the dormant bounded maintenance runner with synthetic SQL only.
    reviewDueSynthetic: (options) =>
      maintenanceRunner
        ? maintenanceRunner.reviewDue(options)
        : { status: 'formal_maintenance_disabled' },
    resumePendingSyntheticXp: ({ userId, asOfIso, limit } = {}) =>
      syntheticDb && syntheticXpEvents.length
        ? syntheticDb.resumePendingXp({
            userId,
            asOfIso,
            limit,
            requiredXpByLevel: ladder.requiredXpByLevel
          })
        : { status: 'formal_xp_disabled' },
    inspectSyntheticMaintenance: () =>
      syntheticDb ? syntheticDb.getSyntheticMaintenanceSummary() : [],
    // Synthetic-only internal post-commit and moderation handoff. Never
    // exposed via readerHttp/adminHttp, beta routes or external credentials.
    enqueueCommittedEarning: (event) =>
      earningRunner
        ? earningRunner.enqueueCommittedEvent(event)
        : { status: 'formal_worker_disabled' },
    submitSyntheticModeration: (review) =>
      earningRunner
        ? earningRunner.submitModeration(review)
        : { status: 'formal_worker_disabled' },
    drainDueEarnings: (options) =>
      earningRunner
        ? earningRunner.drainDue(options)
        : { status: 'formal_worker_disabled', processed: 0 },
    inspectSyntheticQueue: () =>
      syntheticDb ? syntheticDb.inspectQueue() : [],
    interruptNextSyntheticAward: (count) => {
      if (!syntheticDb) throw new Error('SYNTHETIC_QUEUE_DISABLED');
      syntheticDb.interruptNextSyntheticAward(count);
    },
    async readerRequest(userId, request) {
      if (!readerIds.has(userId))
        throw new TypeError('Reader not in synthetic fixture');
      return dispatch(host.handlers.reader, userId, request);
    },
    async adminRequest(request) {
      return dispatch(host.handlers.admin, operatorId, request);
    },
    setMockProviderOutcome(operationId, outcome) {
      if (
        !UUID.test(operationId || '') ||
        !['fulfilled', 'not_fulfilled', 'recovered', 'ai_reversed'].includes(
          outcome
        )
      )
        throw new TypeError('Synthetic provider state required');
      mockProviderState.set(operationId, outcome);
    },
    get mockAiInvocations() {
      return aiInvocations;
    },
    get mockGiftVerifications() {
      return giftVerifications;
    }
  });
}
