// Phase 02-07-04: last-mile owner trial transport, OFF until a separately
// approved, time-boxed, single-episode activation is explicitly configured.
// This module creates no database rows, consent, budget or network requests.
import {
  createOpenAiTextProvider,
  createGeminiTextProvider
} from './providers.js';
import { createOwnerNovelBibleTrialBridgeFactory } from './owner-novel-bible-trial-binding.js';
import { resolveOwnerNovelBiblePreviewConfig } from './owner-novel-bible-preview.js';
import { resolveOwnerNovelBibleConsentRuntimePolicy } from './owner-novel-bible-consent-runtime.js';

const REQUIRED_FLAGS = [
  'NOVELIGHT_AI_ENABLED',
  'NOVELIGHT_AI_ADMIN_PREVIEW_ENABLED',
  'NOVELIGHT_AI_REVIEW_ENABLED',
  'NOVELIGHT_AI_MODEL_TRIAL_ENABLED',
  'NOVELIGHT_AI_EXTERNAL_PROCESSING_APPROVED',
  'NOVELIGHT_AI_CONSENT_UI_ENABLED',
  'NOVELIGHT_AI_CONSENT_SERVER_RUNTIME_ENABLED',
  'NOVELIGHT_AI_TRIAL_LIVE_BINDING_ENABLED'
];
const PROCESSORS = new Set(['openai', 'gemini']);
const MAX_MICROS_PER_REQUEST = 50000000; // 50 yen, not authorization to spend.
const MAX_TRIAL_WINDOW_MS = 24 * 60 * 60 * 1000;

function positiveId(value) {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

function readRoutes(raw) {
  if (typeof raw !== 'string' || raw.length > 3000) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 2) {
      return null;
    }
    const seen = new Set();
    for (const route of parsed) {
      if (
        !route ||
        typeof route !== 'object' ||
        Array.isArray(route) ||
        Object.keys(route).some(
          (key) =>
            ![
              'provider',
              'model',
              'inputMicrosPerMillion',
              'outputMicrosPerMillion',
              'maxOutputTokens'
            ].includes(key)
        ) ||
        !PROCESSORS.has(route.provider) ||
        seen.has(route.provider) ||
        typeof route.model !== 'string' ||
        !/^[a-z0-9._-]{1,100}$/i.test(route.model) ||
        !Number.isSafeInteger(route.inputMicrosPerMillion) ||
        !Number.isSafeInteger(route.outputMicrosPerMillion) ||
        route.inputMicrosPerMillion <= 0 ||
        route.outputMicrosPerMillion <= 0 ||
        !Number.isSafeInteger(route.maxOutputTokens) ||
        route.maxOutputTokens < 1 ||
        route.maxOutputTokens > 4096
      ) {
        return null;
      }
      seen.add(route.provider);
    }
    return parsed;
  } catch {
    return null;
  }
}

function quoteRequestMicros(routes) {
  let total = 0;
  for (const route of routes) {
    // Router accepts at most 36,000 UTF-8 bytes. Reserve for each possible
    // billed provider attempt including fallback, never only the first.
    total += Math.ceil(
      (36000 * route.inputMicrosPerMillion +
        route.maxOutputTokens * route.outputMicrosPerMillion) /
        1000000
    );
    if (!Number.isSafeInteger(total)) return null;
  }
  return total;
}

// Returns null while any prerequisite is absent. No model or price defaults.
// Credential *values* are never logged, returned or sent to client code.
// Optional factories are test-only injection seams, never HTTP arguments.
export function createOwnerNovelBibleLiveTrialBridge({
  env = process.env,
  now = Date.now,
  createClientImpl,
  openAiProviderFactory = createOpenAiTextProvider,
  geminiProviderFactory = createGeminiTextProvider
} = {}) {
  if (REQUIRED_FLAGS.some((flag) => env?.[flag] !== 'true')) return null;
  const config = resolveOwnerNovelBiblePreviewConfig(env);
  const policy = resolveOwnerNovelBibleConsentRuntimePolicy(env);
  const routes = readRoutes(env.NOVELIGHT_AI_TRIAL_ROUTES_JSON);
  const novelId = positiveId(env.NOVELIGHT_AI_TRIAL_ALLOWED_NOVEL_ID);
  const episodeId = positiveId(env.NOVELIGHT_AI_TRIAL_ALLOWED_EPISODE_ID);
  const chunkIndex = env.NOVELIGHT_AI_TRIAL_ALLOWED_CHUNK_INDEX;
  const approvedCap = positiveId(env.NOVELIGHT_AI_TRIAL_MAX_REQUEST_MICROS);
  const expiresRaw = env.NOVELIGHT_AI_TRIAL_EXPIRES_AT;
  const expiresAt =
    typeof expiresRaw === 'string' &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(expiresRaw)
      ? Date.parse(expiresRaw)
      : NaN;
  const current = now();
  const projectedMicros = routes ? quoteRequestMicros(routes) : null;
  const activeProviders = routes && new Set(routes.map((route) => route.provider));
  const disclosed = policy && new Set(policy.disclosures.map((item) => item.processor));
  if (
    !config ||
    !policy ||
    !routes ||
    !novelId ||
    !episodeId ||
    chunkIndex !== '0' ||
    !approvedCap ||
    approvedCap > MAX_MICROS_PER_REQUEST ||
    !Number.isSafeInteger(current) ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= current ||
    expiresAt - current > MAX_TRIAL_WINDOW_MS ||
    disclosed.size !== activeProviders.size ||
    [...activeProviders].some((provider) => !disclosed.has(provider)) ||
    !Number.isSafeInteger(projectedMicros) ||
    projectedMicros < 1 ||
    projectedMicros > approvedCap
  ) {
    return null;
  }

  const providers = {};
  for (const provider of activeProviders) {
    const key = env[provider === 'openai' ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY'];
    if (typeof key !== 'string' || key.length < 16 || key.length > 4096) {
      return null;
    }
    providers[provider] =
      provider === 'openai'
        ? openAiProviderFactory({ apiKey: key })
        : geminiProviderFactory({ apiKey: key });
    if (typeof providers[provider]?.generate !== 'function') return null;
  }

  const factory = createOwnerNovelBibleTrialBridgeFactory({
    enabled: true,
    externalProcessingApproved: true,
    config,
    policyRevision: policy.policyRevision,
    providers,
    routes: { 'novel-bible': routes },
    ...(createClientImpl ? { createClientImpl } : {})
  });

  return async function createTrialBridge(args) {
    if (now() >= expiresAt) {
      throw new Error('AI_BIBLE_MODEL_BRIDGE_DENIED');
    }
    const runtime = await factory(args);
    return Object.freeze({
      async stage(input) {
        // Check at execution time as well as during initialization. An
        // unapproved novel/episode/chunk must not reach Auth, DB or provider.
        if (
          now() >= expiresAt ||
          input?.novelId !== novelId ||
          input?.episodeId !== episodeId ||
          (input?.chunkIndex ?? 0) !== 0
        ) {
          throw new Error('AI_BIBLE_MODEL_BRIDGE_DENIED');
        }
        return runtime.stage(input);
      }
    });
  };
}
