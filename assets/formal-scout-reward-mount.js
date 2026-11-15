// Unpublished presentation mount. Reuses the previously approved draft UI,
// transport bindings and admin panel; creates no HTTP endpoint or network call.
(function () {
  'use strict';
  function mountFormalReaderReward({
    root,
    request,
    nextOperationId,
    newReaderOnboardingAvailable = false
  }) {
    if (
      !globalThis.NovelightFormalScoutReward ||
      !globalThis.NovelightFormalRewardReaderBindings
    )
      throw new TypeError('Formal reader UI modules must be loaded first');
    const binding =
      globalThis.NovelightFormalRewardReaderBindings.createFormalReaderRewardBindings(
        { request, nextOperationId }
      );
    return globalThis.NovelightFormalScoutReward.createRewardReaderPanel({
      root,
      newReaderOnboardingAvailable,
      ...binding
    });
  }

  function mountFormalRewardAdmin({
    root,
    authorized,
    request,
    adminGiftQueueAvailable = false,
    adminSettlementActionsAvailable = false
  }) {
    if (!globalThis.NovelightFormalRewardAdmin)
      throw new TypeError('Formal admin module must be loaded first');
    if (
      adminSettlementActionsAvailable === true &&
      adminGiftQueueAvailable !== true
    )
      throw new TypeError('Gift settlement requires an approved gift queue');
    const {
      loadQueue,
      loadRefunds,
      onResolve,
      ...monitoring
    } = globalThis.NovelightFormalRewardAdmin.createFormalAdminBindings({
      request
    });
    return globalThis.NovelightFormalRewardAdmin.createFormalRewardAdminPanel({
      root,
      authorized,
      ...monitoring,
      ...(adminGiftQueueAvailable === true ? { loadQueue, loadRefunds } : {}),
      ...(adminGiftQueueAvailable === true &&
      adminSettlementActionsAvailable === true
        ? { onResolve }
        : {})
    });
  }

  globalThis.NovelightFormalRewardMount = Object.freeze({
    mountFormalReaderReward,
    mountFormalRewardAdmin
  });
})();
