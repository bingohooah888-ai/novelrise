// CODE ONLY. An independent Controller can issue a signed pre-paid ARM receipt
// only after external STOP/REVOKE/CENSUS capabilities are actually verified.
// No key, claim store, network client or privilege is initialized here.
const REPO = 'bingohooah888-ai/novelrise';
const STAGING = 'wmlzjgvxgoyrovdhbqbg';
const DOMAIN = 'NOVELIGHT_AI_020705_WATCHDOG_ARM_V1';
const NONCE = /^[A-Za-z0-9_-]{32,128}$/u;
const KEY_ID = /^[A-Za-z0-9_-]{8,64}$/u;
const SIGNATURE = /^[A-Za-z0-9_-]{86}$/u;
const SHA = /^[a-f0-9]{40}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const positive = (n) => Number.isSafeInteger(n) && n > 0;
const deny = () => { throw new Error('AI_020705_CONTROLLER_ARM_NO_GO'); };

function scopeValid(s) {
  return s?.repository === REPO && s?.stagingProjectRef === STAGING &&
    SHA.test(s.mainSha ?? '') &&
    /^dpl_[A-Za-z0-9]+$/u.test(s.previewDeploymentId ?? '') &&
    UUID.test(s.actorId ?? '') &&
    ['runId', 'approvalCommentId', 'novelId', 'episodeId']
      .every((k) => positive(s[k])) &&
    ((s.candidateSha === undefined && s.stagingBranch === undefined &&
      s.capMicros === undefined) ||
      (SHA.test(s.candidateSha ?? '') && s.candidateSha !== s.mainSha &&
        /^staging\/ai-02-07-05-[a-z0-9-]+$/u.test(s.stagingBranch ?? '') &&
        positive(s.capMicros) && s.capMicros <= 10000000));
}

/** External ports MUST be independent of the paid runner and truly authorized. */
export function create020705ControllerArmIssuer({
  inspectIndependentArm, claimArmOnce, signWithControllerKey, now = Date.now
} = {}) {
  if ([inspectIndependentArm, claimArmOnce, signWithControllerKey, now]
    .some((fn) => typeof fn !== 'function')) deny();
  return Object.freeze({
    async issue({ scope, nonce, keyId, controllerRunId } = {}) {
      if (!scopeValid(scope) || !NONCE.test(nonce ?? '') ||
          !KEY_ID.test(keyId ?? '') || !positive(controllerRunId) ||
          controllerRunId === scope.runId) deny();
      const observedAtMs = now();
      let proof;
      try {
        proof = await inspectIndependentArm(Object.freeze({
          scope, nonce, controllerRunId
        }));
      } catch { deny(); }
      if (proof?.verifiedIndependentSource !== true ||
          proof?.watchdogArmVerified !== true ||
          proof?.separateFromRunner !== true ||
          proof?.controllerRunId !== controllerRunId ||
          proof?.runId !== scope.runId ||
          proof?.approvalCommentId !== scope.approvalCommentId ||
          proof?.killAuthorityVerified !== true ||
          proof?.stagingDisableVerified !== true ||
          proof?.sessionRevocationVerified !== true ||
          proof?.syntheticCleanupVerified !== true ||
          proof?.zeroCensusVerified !== true ||
          proof?.noPaidRetry !== true ||
          !Number.isFinite(observedAtMs) ||
          !Number.isFinite(proof.heartbeatAtMs) ||
          proof.heartbeatAtMs > observedAtMs ||
          observedAtMs - proof.heartbeatAtMs > 15000) deny();
      // One-use grant is consumed BEFORE signing; failures cannot retry arm.
      let claimed = false;
      try { claimed = (await claimArmOnce({ scope, nonce, controllerRunId })) === true; }
      catch { deny(); }
      if (!claimed) deny();
      const receipt = {
        ...scope,
        kind: 'independent-controller-armed',
        protectedEnvironment: 'staging',
        controllerKind: 'external-independent-supervisor',
        controllerRunId,
        controllerIsRunner: false,
        killAuthorityVerified: true,
        stagingDisableVerified: true,
        sessionRevocationVerified: true,
        syntheticCleanupVerified: true,
        zeroCensusVerified: true,
        noPaidRetry: true,
        observedAtMs,
        heartbeatAtMs: proof.heartbeatAtMs,
        expiresAtMs: observedAtMs + 15000
      };
      let signature;
      try {
        signature = await signWithControllerKey(
          JSON.stringify([DOMAIN, keyId, nonce, receipt]), keyId
        );
      } catch { deny(); }
      if (!SIGNATURE.test(signature ?? '')) deny();
      return Object.freeze({
        domain: DOMAIN, keyId, challengeNonce: nonce, receipt, signature
      });
    }
  });
}
