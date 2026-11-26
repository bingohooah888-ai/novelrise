// Offline integration candidate. The local switch stays off by default.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const OWNER = 'bingohooah888-ai';
const ISSUE = 'https://api.github.com/repos/bingohooah888-ai/novelrise/issues/1837';
const PREFIX = 'NOVELIGHT_NLO_WORKTREE_CREATE_APPROVAL ';
const ID = /^cmdr-[0-9]{8}T[0-9]{6}Z-[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;
const SHA = /^[a-f0-9]{40}$/;
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;
const TTL = 15 * 60 * 1000;
const fail = () => { throw new Error('NLO_CREATE_AUTHORIZATION_DENIED'); };
const keys = (o, expected) => o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).sort().join(',') === [...expected].sort().join(',');

function ownerComment(c, now) {
  const created = Date.parse(c?.created_at);
  if (!Number.isSafeInteger(c?.id) || c.id < 1 || c.user?.login !== OWNER || c.author_association !== 'OWNER' || c.issue_url !== ISSUE || c.created_at !== c.updated_at || !Number.isFinite(created) || created > now || now - created > TTL) fail();
  return created;
}

export function validateCreationApproval({ request, source, approval, now = Date.now(), enabled = false }) {
  if (enabled !== true || !keys(request, ['operation','requestId','branch','expectedHead','confirmation','approvalCommentId']) || request.operation !== 'create_isolated' || !ID.test(request.requestId) || !SHA.test(request.expectedHead) || !BRANCH.test(request.branch) || /^(main|master)$/i.test(request.branch) || request.branch.includes('..') || request.branch.includes('//') || request.branch.endsWith('/') || request.confirmation !== 'CHAT_APPROVED' || !Number.isSafeInteger(request.approvalCommentId) || request.approvalCommentId < 1) fail();
  const requestedAt = ownerComment(source, now);
  const approvedAt = ownerComment(approval, now);
  if (approval.id !== request.approvalCommentId || approval.id >= source.id || approvedAt > requestedAt || !String(approval.body).startsWith(PREFIX)) fail();
  let binding;
  try { binding = JSON.parse(approval.body.slice(PREFIX.length)); } catch { fail(); }
  if (!keys(binding, ['requestId','branch','expectedHead','scope']) || binding.requestId !== request.requestId || binding.branch !== request.branch || binding.expectedHead !== request.expectedHead || binding.scope !== 'create-isolated-worktree-only') fail();
  return Object.freeze({ requestId: request.requestId, approvalId: approval.id, branch: request.branch, expectedHead: request.expectedHead });
}

// The creation operation must use the same repository as the existing
// OWNER-approved Bridge configuration, not merely the inherited cwd/root.
export async function assertCreationRootBinding(configuredRepoRoot, securityRoot) {
  if (typeof configuredRepoRoot !== 'string' || typeof securityRoot !== 'string' ||
      !path.isAbsolute(configuredRepoRoot) || !path.isAbsolute(securityRoot)) fail();
  const normalize = p => process.platform === 'win32'
    ? path.resolve(p).toLowerCase() : path.resolve(p);
  try {
    const configured = normalize(configuredRepoRoot);
    const permitted = normalize(securityRoot);
    if (configured !== permitted) fail();
    const info = await fs.lstat(configuredRepoRoot);
    const physical = await fs.realpath(configuredRepoRoot);
    const permittedPhysical = await fs.realpath(securityRoot);
    if (!info.isDirectory() || info.isSymbolicLink() ||
        normalize(physical) !== configured ||
        normalize(permittedPhysical) !== permitted) fail();
    return true;
  } catch { fail(); }
}

// This directory is derived from the pre-existing local Bridge state path,
// not supplied by a remote request. Claim is never removed on failure.
export async function claimCreation(statePath, binding) {
  const dir = path.dirname(statePath);
  const info = await fs.lstat(dir);
  const physical = await fs.realpath(dir);
  const normalize = p => process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p);
  if (!info.isDirectory() || info.isSymbolicLink() || normalize(physical) !== normalize(dir)) fail();
  // Single use per approval record, including across daemon restarts.
  const digest = createHash('sha256').update(String(binding.approvalId)).digest('hex');
  const target = path.join(dir, `worktree-create-claim-${digest}.json`);
  let handle;
  try {
    handle = await fs.open(target, 'wx', 0o600);
    await handle.writeFile(JSON.stringify(binding) + '\n', 'utf8');
    await handle.sync();
  } catch { fail(); } finally { if (handle) await handle.close(); }
}
