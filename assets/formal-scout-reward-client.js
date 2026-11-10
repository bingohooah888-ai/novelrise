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
    // Keep the same operation ID across an uncertain network response.
    // A second tap must not mint a new claim for the same unresolved action.
    const unresolved = new Map();
    async function submit(key, payload) {
      const id = unresolved.get(key) || operationId();
      unresolved.set(key, id);
      const result = await call('POST', { ...payload, operationId: id });
      if (result.ok === false) throw new Error('REWARD_REQUEST_NOT_CONFIRMED');
      if (
        [
          'request_received',
          'started',
          'already_processed',
          'released'
        ].includes(result.status)
      )
        unresolved.delete(key);
      return result;
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
        return submit('exchange:' + amountPoints, {
          action: 'exchange_request',
          amountPoints
        });
      },
      onAiUse: async ({ featureId }) => {
        if (
          typeof featureId !== 'string' ||
          !/^[a-z][a-z0-9_-]{1,79}$/.test(featureId)
        )
          return { status: 'ai_feature_invalid' };
        return submit('ai:' + featureId, {
          action: 'ai_use',
          featureId
        });
      }
    });
  }
  globalThis.NovelightFormalRewardReaderBindings = Object.freeze({
    createFormalReaderRewardBindings
  });
})();
