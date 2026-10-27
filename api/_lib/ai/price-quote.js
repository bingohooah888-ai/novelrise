// Phase 02-07-03. Offline, fail-closed estimate ONLY.
// Converts verified provider USD prices into integer micro-JPY route ceilings.
// No external calls, runtime route activation, entitlement, DB writes or keys.
// Pricing must be manually verified/reapproved before any provider activation.
const MILLION = 1000000n;
const BPS = 10000n;
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const MODEL = /^[a-z0-9._-]{1,100}$/i;
const PROVIDERS = new Set(['openai', 'gemini']);

function invalid() {
  throw new Error('AI_PRICE_QUOTE_INVALID');
}

function integer(value, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) invalid();
  return BigInt(value);
}

function ceilDiv(value, divisor) {
  return (value + divisor - 1n) / divisor;
}

function safeNumber(value) {
  if (value > MAX_SAFE || value < 0n) invalid();
  return Number(value);
}

// USD price inputs are *micro-USD per million model tokens*.
// e.g. $0.30/1M tokens = 300_000, not 0.30.
// No market rate is embedded here: caller supplies a separately verified,
// conservatively rounded-UP integer exchange rate and risk multiplier.
export function quoteAiProviderCeiling({
  routes,
  maxInputTokens,
  fxYenPerUsdCeiling,
  riskBufferBps
}) {
  if (!Array.isArray(routes) || routes.length < 1 || routes.length > 2) {
    invalid();
  }
  const inputCeiling = integer(maxInputTokens, 1, 36000);
  const fx = integer(fxYenPerUsdCeiling, 1, 1000);
  const risk = integer(riskBufferBps, 10000, 30000);
  const converted = [];
  let total = 0n;

  for (const route of routes) {
    if (
      !route ||
      typeof route !== 'object' ||
      Array.isArray(route) ||
      !PROVIDERS.has(route.provider) ||
      typeof route.model !== 'string' ||
      !MODEL.test(route.model)
    ) {
      invalid();
    }
    const inputUsd = integer(route.inputUsdMicrosPerMillion, 1, 1000000000);
    const outputUsd = integer(route.outputUsdMicrosPerMillion, 1, 1000000000);
    const maxOutput = integer(route.maxOutputTokens, 1, 4096);
    // Rates are micro-JPY / 1M tokens, the same unit the AI Router expects.
    const inputMicrosPerMillion = ceilDiv(inputUsd * fx * risk, BPS);
    const outputMicrosPerMillion = ceilDiv(outputUsd * fx * risk, BPS);
    const ceilingMicros = ceilDiv(
      inputCeiling * inputMicrosPerMillion + maxOutput * outputMicrosPerMillion,
      MILLION
    );
    converted.push({
      provider: route.provider,
      model: route.model,
      inputMicrosPerMillion: safeNumber(inputMicrosPerMillion),
      outputMicrosPerMillion: safeNumber(outputMicrosPerMillion),
      maxOutputTokens: Number(maxOutput),
      ceilingMicros: safeNumber(ceilingMicros)
    });
    // Failed/timeout attempts may still incur charges. Include BOTH routes.
    total += ceilingMicros;
  }
  if (total < 1n) invalid();
  return {
    maxInputTokens: Number(inputCeiling),
    riskBufferBps: Number(risk),
    quoteMicrosJPY: safeNumber(total),
    routes: converted
  };
}
