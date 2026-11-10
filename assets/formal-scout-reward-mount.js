// Unpublished presentation mount. Reuses the previously approved draft UI,
// transport bindings and admin panel; creates no HTTP endpoint or network call.
(function () {
  'use strict';
  function mountFormalReaderReward({ root, request, nextOperationId }) {
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
      ...binding
    });
  }

  function mountFormalRewardAdmin({ root, authorized, request }) {
    if (!globalThis.NovelightFormalRewardAdmin)
      throw new TypeError('Formal admin module must be loaded first');
    const binding =
      globalThis.NovelightFormalRewardAdmin.createFormalAdminBindings({
        request
      });
    return globalThis.NovelightFormalRewardAdmin.createFormalRewardAdminPanel({
      root,
      authorized,
      ...binding
    });
  }

  globalThis.NovelightFormalRewardMount = Object.freeze({
    mountFormalReaderReward,
    mountFormalRewardAdmin
  });
})();
