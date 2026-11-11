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
    nextOperationId
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
      if (typeof nextOperationId !== 'function')
        throw new TypeError('Reader operation UUID provider required');
      bindings.reader = () =>
        mount.mountFormalReaderReward({
          root: readerRoot,
          nextOperationId,
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
