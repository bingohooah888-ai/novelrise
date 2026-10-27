import { createHash } from 'node:crypto';
import { requireAiFeature } from './registry.js';

export class AiRouterError extends Error {
  constructor(code) {
    super(code);
    this.name = 'AiRouterError';
    this.code = code;
  }
}

const hash = (input) =>
  createHash('sha256').update(JSON.stringify(input)).digest('hex');

function validateRoute(route, providers) {
  if (
    !route ||
    !Object.hasOwn(providers, route.provider) ||
    typeof providers[route.provider]?.generate !== 'function' ||
    typeof route.model !== 'string' ||
    !/^[a-z0-9._-]{1,100}$/i.test(route.model) ||
    !Number.isSafeInteger(route.inputMicrosPerMillion) ||
    !Number.isSafeInteger(route.outputMicrosPerMillion) ||
    route.inputMicrosPerMillion < 0 ||
    route.outputMicrosPerMillion < 0 ||
    !Number.isSafeInteger(route.maxOutputTokens) ||
    route.maxOutputTokens < 1 ||
    route.maxOutputTokens > 4096
  ) {
    throw new AiRouterError('AI_INVALID_ROUTE');
  }
}

function projectedCharge(route, inputTokens, outputTokens) {
  return Math.ceil(
    (inputTokens * route.inputMicrosPerMillion +
      outputTokens * route.outputMicrosPerMillion) /
      1000000
  );
}

export function createAiRouter({
  authorize,
  budget,
  audit,
  providers,
  routes,
  cache = null,
  enabled = false
}) {
  if (
    typeof authorize !== 'function' ||
    !budget ||
    typeof budget.reserve !== 'function' ||
    typeof budget.settle !== 'function' ||
    !audit ||
    typeof audit.record !== 'function' ||
    !providers ||
    !routes
  ) {
    throw new AiRouterError('AI_SECURITY_BACKEND_REQUIRED');
  }

  return {
    async run({
      featureKey,
      principal,
      workId,
      revision,
      readerScope = null,
      system,
      user
    }) {
      if (!enabled) throw new AiRouterError('AI_DISABLED');
      const feature = requireAiFeature(featureKey);
      if (!principal?.id || !workId || !revision) {
        throw new AiRouterError('AI_ACCESS_DENIED');
      }
      if (
        typeof system !== 'string' ||
        typeof user !== 'string' ||
        !system ||
        !user ||
        Buffer.byteLength(system + user, 'utf8') > 36000
      ) {
        throw new AiRouterError('AI_INVALID_INPUT');
      }

      // Server-side authorizer must verify ownership, reader progress, or admin
      // allowlist against trusted DB state on EVERY request (including cache hits).
      const allowed = await authorize({
        feature,
        principal,
        workId,
        readerScope
      });
      if (allowed !== true) throw new AiRouterError('AI_ACCESS_DENIED');

      const candidates = routes[featureKey] || routes[feature.costTier];
      if (
        !Array.isArray(candidates) ||
        !candidates.length ||
        candidates.length > 2
      ) {
        throw new AiRouterError('AI_ROUTE_NOT_CONFIGURED');
      }
      candidates.forEach((route) => validateRoute(route, providers));

      const fingerprint = hash({
        actor: principal.id,
        workId,
        revision,
        readerScope,
        featureKey,
        messages: [system, user],
        routes: candidates.map((route) => [route.provider, route.model])
      });
      const cached = cache ? await cache.get(fingerprint) : null;
      if (cached && typeof cached.text === 'string') {
        await audit.record({
          featureKey,
          actorId: principal.id,
          workId,
          cacheHit: true,
          chargedMicros: 0
        });
        return { ...cached, cached: true };
      }

      // Pessimistic UTF-8 byte count avoids under-reserving Japanese content.
      // Fallback attempts may BOTH be billed, so reserve their combined ceiling.
      const tokenCeiling = Buffer.byteLength(system + user, 'utf8');
      const ceilingMicros = candidates.reduce(
        (sum, route) =>
          sum + projectedCharge(route, tokenCeiling, route.maxOutputTokens),
        0
      );
      if (!Number.isSafeInteger(ceilingMicros) || ceilingMicros < 1) {
        throw new AiRouterError('AI_PRICE_NOT_CONFIGURED');
      }

      // Must be one ATOMIC, durable reservation respecting per-user/day/month
      // and global budgets. No in-process counters or silent free fallback.
      const reservation = await budget.reserve({
        actorId: principal.id,
        featureKey,
        workId,
        ceilingMicros,
        requestHash: fingerprint
      });
      if (!reservation?.id) throw new AiRouterError('AI_BUDGET_DENIED');

      let chargedMicros = 0;
      let lastError = null;
      let response = null;
      let selectedRoute = null;
      try {
        for (const route of candidates) {
          selectedRoute = route;
          try {
            const result = await providers[route.provider].generate({
              model: route.model,
              system,
              user,
              maxOutputTokens: route.maxOutputTokens,
              timeoutMs: Math.min(
                Math.max(route.timeoutMs || 15000, 1000),
                30000
              )
            });
            if (
              !result ||
              typeof result.text !== 'string' ||
              !result.text.trim()
            ) {
              throw new AiRouterError('AI_EMPTY_RESPONSE');
            }
            const inputTokens = Number(result.usage?.inputTokens);
            const outputTokens = Number(result.usage?.outputTokens);
            // Missing/invalid usage is conservatively charged at route ceiling.
            const validUsage =
              Number.isSafeInteger(inputTokens) &&
              inputTokens >= 0 &&
              inputTokens <= tokenCeiling &&
              Number.isSafeInteger(outputTokens) &&
              outputTokens >= 0 &&
              outputTokens <= route.maxOutputTokens;
            chargedMicros += validUsage
              ? projectedCharge(route, inputTokens, outputTokens)
              : projectedCharge(route, tokenCeiling, route.maxOutputTokens);
            response = {
              text: result.text.slice(0, 16000),
              provider: route.provider,
              model: route.model,
              cached: false
            };
            break;
          } catch (error) {
            chargedMicros += projectedCharge(
              route,
              tokenCeiling,
              route.maxOutputTokens
            );
            lastError = error;
            // Never fall back for access, validation, blocked content,
            // wrong credentials, or uncertain domain failures.
            if (error?.retryable !== true) break;
          }
        }
      } finally {
        // On network failure a provider might still bill. Charge the upper
        // bound for uncertain attempts rather than refunding them blindly.
        await budget.settle({
          reservationId: reservation.id,
          chargedMicros: Math.min(ceilingMicros, chargedMicros)
        });
        await audit.record({
          featureKey,
          actorId: principal.id,
          workId,
          provider: selectedRoute?.provider || null,
          model: selectedRoute?.model || null,
          chargedMicros: Math.min(ceilingMicros, chargedMicros),
          cacheHit: false,
          outcome: response ? 'success' : 'failed'
        });
      }

      if (!response) {
        throw new AiRouterError(lastError?.code || 'AI_PROVIDER_UNAVAILABLE');
      }
      if (cache) {
        // Cache failures must not create an extra billable retry.
        try {
          await cache.set(fingerprint, response);
        } catch {
          // Observability is handled separately; the generated result is valid.
        }
      }
      return response;
    }
  };
}
