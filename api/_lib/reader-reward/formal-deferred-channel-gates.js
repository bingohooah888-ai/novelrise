// OWNER 2026-11-15: external gift operation details and AI Point prices
// remain undecided. These two channels are hard-OFF independently of formal
// reader XP, Level, earning and wallet-read readiness.
// No env var, provider callback, catalog entry or cutover flag may override
// this module. Future activation requires an explicit OWNER-approved code PR.
export const OWNER_DEFERRED_CHANNELS = Object.freeze({
  externalGiftExchange: false,
  aiDirectPointUse: false
});

export function holdDeferredFormalChannels({ catalog = [], policy = {} } = {}) {
  const items = Array.isArray(catalog) ? catalog : [];
  return Object.freeze({
    catalog: Object.freeze(
      items.map((feature) =>
        Object.freeze({
          ...feature,
          approved: false,
          pricePoints: null
        })
      )
    ),
    policy: Object.freeze({
      ...policy,
      giftProviderReady: false,
      verifyExchange: undefined,
      verifyAi: undefined
    }),
    // Never pass an executable AI adapter to the unregistered formal host.
    aiExecutor: undefined
  });
}
