// Code-only OWNER source. Never trust caller-provided run scope.
// Identity verification and privileged Staging ports are separately required.
import { read020705OwnerLedgerFromGithub } from './github-owner-ledger-readonly-reader.mjs';

const REPO = 'bingohooah888-ai/novelrise';
const PROJECT = 'wmlzjgvxgoyrovdhbqbg';
const PREFIX = 'NOVELIGHT_STAGING_AI_020705_PAID_APPROVE ';
const URL = 'https://api.github.com/repos/' + REPO + '/issues/comments/';
const SHA = /^[0-9a-f]{40}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const BRANCH = /^staging\/ai-02-07-05-[a-z0-9-]+$/u;
const BASE = ['actorId', 'approvalScope', 'capMicros', 'confirmation',
  'consentRevision', 'episodeId', 'expiresAt', 'mainSha', 'model',
  'novelId', 'previewDeploymentId', 'provider', 'stagingProjectRef'].sort();
const EXTRA = ['approvalIssueNumber', 'candidateSha', 'repository',
  'runId', 'stagingBranch'];
const KEYS = ['repository', 'stagingProjectRef', 'mainSha',
  'previewDeploymentId', 'actorId', 'novelId', 'episodeId', 'runId',
  'approvalCommentId'];
const positive = (x) => Number.isSafeInteger(x) && x > 0;
function deny() { throw new Error('AI_020705_CONTROLLER_OWNER_SOURCE_NO_GO'); }

export function create020705GithubControllerOwnerPortCandidate({
  token, controllerRunId, verifyIndependentControllerIdentity,
  fetchImpl = globalThis.fetch, now = Date.now
} = {}) {
  if (typeof token !== 'string' || token.length < 12 || token.length > 4096 ||
      !positive(controllerRunId) ||
      typeof verifyIndependentControllerIdentity !== 'function' ||
      typeof fetchImpl !== 'function' || typeof now !== 'function') deny();
  const verified = new WeakMap();
  async function readOwnerApprovedScope(query) {
    try {
      const names = Object.keys(query ?? {}).sort().join(',');
      if (names !== 'approvalCommentId,repository,runId,stagingProjectRef' &&
          names !== 'approvalCommentId,arm,repository,runId,stagingProjectRef' &&
          names !== 'approvalCommentId,armReceipt,repository,runId,stagingProjectRef')
        deny();
      if (query.repository !== REPO || query.stagingProjectRef !== PROJECT ||
          !positive(query.runId) || !positive(query.approvalCommentId) ||
          query.runId === controllerRunId ||
          (Object.hasOwn(query, 'arm') && query.arm !== true) ||
          (Object.hasOwn(query, 'armReceipt') && query.armReceipt !== true)) deny();
      const response = await fetchImpl(URL + query.approvalCommentId, {
        method: 'GET', redirect: 'error',
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          Authorization: 'Bearer ' + token
        }
      });
      if (response?.status !== 200 || typeof response.json !== 'function')
        deny();
      const comment = await response.json();
      if (comment?.id !== query.approvalCommentId ||
          comment?.user?.login !== 'bingohooah888-ai' ||
          comment?.user?.id !== 317436651 ||
          comment?.user?.type !== 'User' ||
          comment?.author_association !== 'OWNER' ||
          comment?.created_at !== comment?.updated_at ||
          typeof comment.body !== 'string' ||
          !comment.body.startsWith(PREFIX) || comment.body.length > 4096)
        deny();
      const approved = JSON.parse(comment.body.slice(PREFIX.length));
      const candidate = Object.hasOwn(approved, 'candidateSha') ||
        Object.hasOwn(approved, 'stagingBranch');
      const fields = candidate ? [...BASE, ...EXTRA].sort() : BASE;
      if (!approved || Array.isArray(approved) ||
          JSON.stringify(Object.keys(approved).sort()) !==
            JSON.stringify(fields) ||
          approved.stagingProjectRef !== PROJECT ||
          approved.provider !== 'openai' || approved.model !== 'gpt-6.1-sol' ||
          approved.confirmation !== 'STAGING PAID 1 CALL APPROVED' ||
          approved.approvalScope !== 'synthetic-one-provider-one-call-only' ||
          !SHA.test(approved.mainSha ?? '') ||
          !/^dpl_[A-Za-z0-9]+$/u.test(approved.previewDeploymentId ?? '') ||
          !UUID.test(approved.actorId ?? '') ||
          !positive(approved.novelId) || !positive(approved.episodeId) ||
          !positive(approved.capMicros) || approved.capMicros > 10000000 ||
          ((query.arm === true || query.armReceipt === true) && (
            !Number.isFinite(Date.parse(approved.expiresAt)) ||
            Date.parse(approved.expiresAt) <= now()
          )) ||
          (candidate && (
            approved.repository !== REPO ||
            approved.approvalIssueNumber !== 294 ||
            approved.runId !== query.runId ||
            !SHA.test(approved.candidateSha ?? '') ||
            approved.candidateSha === approved.mainSha ||
            !BRANCH.test(approved.stagingBranch ?? '')
          ))) deny();
      const s = {
        repository: REPO, issueNumber: 294, runId: query.runId,
        approvalCommentId: query.approvalCommentId, mainSha: approved.mainSha,
        previewDeploymentId: approved.previewDeploymentId,
        actorId: approved.actorId, novelId: approved.novelId,
        episodeId: approved.episodeId, provider: approved.provider,
        model: approved.model, capMicros: approved.capMicros,
        consentRevision: approved.consentRevision, stagingProjectRef: PROJECT,
        ...(candidate ? {
          candidateSha: approved.candidateSha,
          stagingBranch: approved.stagingBranch
        } : {})
      };
      const ledger = await read020705OwnerLedgerFromGithub({
        token, scope: s, fetchImpl, now
      });
      // ARM precedes the OWNER CLAIM; recovery remains separate.
      // An already claimed or consumed approval cannot issue a new ARM.
      if (ledger?.authorizesPaidCall !== false ||
          (query.armReceipt === true && !candidate) ||
          (query.arm === true
            ? !candidate || ledger.status !== 'UNCLAIMED' ||
              ledger.claimed !== false || ledger.consumed !== false
            : ledger.status !== 'CLAIMED' || ledger.claimed !== true ||
              ledger.consumed !== false)) deny();
      // This must be a pinned, off-Runner identity attestation in production.
      // A callback returning true is only a mock, never a live proof.
      if ((await verifyIndependentControllerIdentity({
        controllerRunId, runId: query.runId,
        approvalCommentId: query.approvalCommentId, mainSha: approved.mainSha,
        previewDeploymentId: approved.previewDeploymentId
      })) !== true) deny();
      const scope = Object.freeze({
        ...Object.fromEntries(KEYS.map((key) => [key, s[key]])),
        ...((query.arm === true || query.armReceipt === true) && candidate ? {
          candidateSha: approved.candidateSha,
          stagingBranch: approved.stagingBranch, capMicros: approved.capMicros
        } : {})
      });
      const proof = Object.freeze({
        repository: REPO, stagingProjectRef: PROJECT, runId: query.runId,
        approvalCommentId: query.approvalCommentId, controllerRunId,
        sourceVerified: true, ownerApproved: true, scope
      });
      verified.set(proof, Object.freeze({
        arm: query.arm === true, armReceipt: query.armReceipt === true
      }));
      return proof;
    } catch { deny(); }
  }
  return Object.freeze({
    readOwnerApprovedScope,
    verifyOwnerApprovalAttestation: async (proof, query) =>
      !!proof &&
      verified.get(proof)?.arm === (query?.arm === true) &&
      verified.get(proof)?.armReceipt === (query?.armReceipt === true) &&
      proof.repository === REPO && proof.stagingProjectRef === PROJECT &&
      proof.runId === query?.runId &&
      proof.approvalCommentId === query?.approvalCommentId
  });
}
