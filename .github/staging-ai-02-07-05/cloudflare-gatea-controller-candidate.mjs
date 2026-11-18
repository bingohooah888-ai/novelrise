// SOURCE CANDIDATE ONLY. No live bootstrap, secrets, routes or deployment.
// A distinct Cloudflare Worker may be approved later as a Staging-only
// recovery receiver. It MUST NOT run in the paid Runner process.
// Reuses existing signature, one-shot claim, STOP, auth and census gates.
import { create020705ExistingWatchdogEntrypoint } from './existing-watchdog-entrypoint.mjs';

const REPO = 'bingohooah888-ai/novelrise';
const STAGING = 'wmlzjgvxgoyrovdhbqbg';
const ROUTE = '/_novelight/gatea/recover';
const SCOPE_KEYS = [
  'repository', 'stagingProjectRef', 'mainSha', 'previewDeploymentId',
  'actorId', 'novelId', 'episodeId', 'runId', 'approvalCommentId'
];
const SHA = /^[a-f0-9]{40}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const positive = (n) => Number.isSafeInteger(n) && n > 0;
const blocked = () => new Response(null, {
  status: 404, headers: { 'cache-control': 'no-store' }
});

function validScope(value) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === SCOPE_KEYS.length &&
    SCOPE_KEYS.every((key) => Object.hasOwn(value, key)) &&
    value.repository === REPO && value.stagingProjectRef === STAGING &&
    SHA.test(value.mainSha) &&
    /^dpl_[A-Za-z0-9]+$/u.test(value.previewDeploymentId) &&
    UUID.test(value.actorId) &&
    ['novelId', 'episodeId', 'runId', 'approvalCommentId']
      .every((key) => positive(value[key]));
}

function exactScope(a, b) {
  return validScope(a) && validScope(b) &&
    SCOPE_KEYS.every((key) => a[key] === b[key]);
}

/**
 * Code-only composition. Dependencies are NOT provided by this repository.
 * resolveTrustedRun MUST read an OWNER-approved immutable run scope from an
 * authenticated independent source, not echo the request JSON.
 * readIndependentCapabilities MUST obtain real, separately authorized proof.
 * makeStagingStopPorts MUST return dedicated Staging-only clients and a
 * durable atomic recovery claim; booleans or synthetic mocks are not proof.
 * Missing or unverified prerequisites fail closed before any STOP callback.
 */
export function create020705ControllerCandidate({
  resolveTrustedRun, readIndependentCapabilities, makeStagingStopPorts
} = {}) {
  if (![resolveTrustedRun, readIndependentCapabilities, makeStagingStopPorts]
    .every((fn) => typeof fn === 'function')) {
    throw new Error('AI_020705_CONTROLLER_PORTS_UNAVAILABLE');
  }
  return Object.freeze({
    async fetch(request, env) {
      try {
        if (env?.GATEA_CONTROLLER_LIVE_ENABLED !== 'true' ||
            request?.method !== 'POST' ||
            new URL(request.url).pathname !== ROUTE ||
            request.headers.get('content-type') !== 'application/json') {
          return blocked();
        }
        const size = Number(request.headers.get('content-length'));
        if (Number.isFinite(size) && size > 4096) return blocked();
        const raw = await request.text();
        if (!raw || raw.length > 4096) return blocked();
        const input = JSON.parse(raw);
        if (!input || typeof input !== 'object' || Array.isArray(input) ||
            Object.keys(input).sort().join(',') !== 'envelope,scope' ||
            !validScope(input.scope)) return blocked();
        const trusted = await resolveTrustedRun(Object.freeze({
          repository: REPO, stagingProjectRef: STAGING,
          runId: input.scope.runId,
          approvalCommentId: input.scope.approvalCommentId
        }));
        if (!trusted || trusted.sourceVerified !== true ||
            trusted.ownerApproved !== true ||
            !exactScope(trusted.scope, input.scope) ||
            !positive(trusted.controllerRunId) ||
            trusted.controllerRunId === trusted.scope.runId) return blocked();
        const capabilities = await readIndependentCapabilities(trusted);
        if (capabilities?.verifiedIndependentSource !== true ||
            capabilities?.separateFromRunner !== true ||
            capabilities?.signedDeathProofAvailable !== true ||
            capabilities?.atomicRecoveryClaimAvailable !== true ||
            capabilities?.stagingStopAuthorityVerified !== true ||
            capabilities?.syntheticRevocationVerified !== true ||
            capabilities?.independentCensusVerified !== true) return blocked();
        const ports = await makeStagingStopPorts(trusted);
        // No default credentials or permissive fallback. All privileges must
        // be provisioned outside GitHub under later explicit OWNER approval.
        if (ports?.synthetic?.verifiedSynthetic !== true ||
            ports?.synthetic?.projectRef !== STAGING ||
            ports?.synthetic?.userId !== trusted.scope.actorId ||
            ports?.synthetic?.novelId !== trusted.scope.novelId ||
            ports?.synthetic?.approvalCommentId !==
              trusted.scope.approvalCommentId ||
            ports?.serviceClient?.supabaseUrl !==
              'https://' + STAGING + '.supabase.co' ||
            !ports?.trustedControllerPublicKey ||
            !ports?.trustedControllerKeyId ||
            !ports?.expectedChallengeNonce ||
            !['claimRecoveryOnce', 'stopModelTransport',
              'disableTrialEnvironment', 'revokeSyntheticSessions',
              'independentCensus'].every((key) =>
              typeof ports[key] === 'function')) return blocked();
        const entry = create020705ExistingWatchdogEntrypoint({
          scope: trusted.scope,
          controllerRunId: trusted.controllerRunId,
          readControllerCapabilities: async () =>
            readIndependentCapabilities(trusted),
          stopOptions: ports
        });
        return await entry.handleRecoveryRequest(new Request(
          'https://gatea-recovery.internal' + ROUTE, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: raw
          }
        ));
      } catch {
        return blocked();
      }
    }
  });
}

// Deliberately inert even if this source candidate is accidentally deployed.
// An independently reviewed privileged bootstrap is a separate approval.
export default Object.freeze({ async fetch() { return blocked(); } });
