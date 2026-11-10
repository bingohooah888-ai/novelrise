// Browser-to-host binding for the unpublished reader reward panel.
// No URL, credentials, API route or network connection is created here.
// The approved application host injects the transport and auth session.
(function () {
  'use strict';
  const UUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function createFormalReaderRewardBindings({ request, nextOperationId }) {
    if (typeof request !== 'function' || typeof nextOperationId !== 'function')
      throw new TypeError(
        'Trusted host request adapter and operation ID required'
      );
    async function call(method, body) {
      const result = await request({ method, body });
      if (!result || typeof result !== 'object')
        throw new Error('REWARD_RESPONSE_INVALID');
      return result;
    }
    function operationId() {
      const id = nextOperationId();
      if (!UUID.test(id)) throw new Error('REWARD_OPERATION_ID_INVALID');
      return id;
    }
    return Object.freeze({
      fetchSnapshot: async () => {
        const data = await call('GET');
        if (data.serverVerified !== true)
          throw new Error('REWARD_SNAPSHOT_UNVERIFIED');
        return data;
      },
      onExchange: async ({ amountPoints }) => {
        if (!Number.isSafeInteger(amountPoints) || amountPoints < 30000)
          return { status: 'below_exchange_minimum' };
        return call('POST', {
          action: 'exchange_request',
          operationId: operationId(),
          amountPoints
        });
      },
      onAiUse: async ({ featureId }) => {
        if (
          typeof featureId !== 'string' ||
          !/^[a-z][a-z0-9_-]{1,79}$/.test(featureId)
        )
          return { status: 'ai_feature_invalid' };
        return call('POST', {
          action: 'ai_use',
          operationId: operationId(),
          featureId
        });
      }
    });
  }
  globalThis.NovelightFormalRewardReaderBindings = Object.freeze({
    createFormalReaderRewardBindings
  });
})();
