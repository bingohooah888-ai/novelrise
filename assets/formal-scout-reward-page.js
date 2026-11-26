// Explicit-only formal reader/admin mounting for an approved future page.
// No production script references this asset; no default auth, route, or fetch.
(function () {
  'use strict';
  function prepareFormalRewardPage({
    readerRoot,
    adminRoot,
    authorized,
    readerEndpoint,
    adminEndpoint,
    getAccessToken,
    fetchImpl,
    nextOperationId,
    newReaderOnboardingAvailable = false,
    readerExchangeAvailable = false,
    readerAiPointAvailable = false,
    adminGiftQueueAvailable = false,
    adminSettlementActionsAvailable = false
  } = {}) {
    const transport = globalThis.NovelightFormalRewardTransport;
    const mount = globalThis.NovelightFormalRewardMount;
    if (
      !transport ||
      !mount ||
      (!readerRoot && !adminRoot) ||
      typeof getAccessToken !== 'function' ||
      typeof fetchImpl !== 'function'
    ) {
      throw new TypeError('Approved formal reward page dependencies required');
    }
    const bindings = {};
    if (readerRoot) {
      if (
        (readerExchangeAvailable === true || readerAiPointAvailable === true) &&
        typeof nextOperationId !== 'function'
      )
        throw new TypeError('Reader Point actions require operation UUIDs');
      bindings.reader = () =>
        mount.mountFormalReaderReward({
          root: readerRoot,
          nextOperationId,
          newReaderOnboardingAvailable,
          readerExchangeAvailable,
          readerAiPointAvailable,
          request: transport.createFormalRewardTransport({
            endpoint: readerEndpoint,
            getAccessToken,
            fetchImpl
          })
        });
    }
    if (adminRoot) {
      bindings.admin = () =>
        mount.mountFormalRewardAdmin({
          root: adminRoot,
          authorized: authorized === true,
          adminGiftQueueAvailable,
          adminSettlementActionsAvailable,
          request: transport.createFormalRewardTransport({
            endpoint: adminEndpoint,
            getAccessToken,
            fetchImpl
          })
        });
    }
    return Object.freeze(bindings);
  }
  globalThis.NovelightFormalRewardPage = Object.freeze({
    prepareFormalRewardPage
  });
})();
