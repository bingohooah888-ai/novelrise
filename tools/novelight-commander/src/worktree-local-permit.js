import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const TTL = 15 * 60 * 1000;
const fail = () => { throw new Error('NLO_LOCAL_PERMIT_DENIED'); };
const exact = (o, k) => o && typeof o === 'object' && !Array.isArray(o) &&
  Object.keys(o).sort().join(',') === [...k].sort().join(',');
const canonical = p => process.platform === 'win32'
  ? path.resolve(p).toLowerCase() : path.resolve(p);

async function verifyDirectory(dir) {
  const st = await fs.lstat(dir);
  if (!st.isDirectory() || st.isSymbolicLink() ||
      canonical(await fs.realpath(dir)) !== canonical(dir)) fail();
}

export function validateLocalPermit(permit, binding, now = Date.now()) {
  if (!exact(permit, ['operation','requestId','branch','expectedHead','issuedAt','expiresAt']) ||
      permit.operation !== 'create_isolated' ||
      !/^cmdr-[0-9]{8}T[0-9]{6}Z-[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/.test(permit.requestId) ||
      !/^[a-f0-9]{40}$/.test(permit.expectedHead) ||
      permit.requestId !== binding.requestId || permit.branch !== binding.branch ||
      permit.expectedHead !== binding.expectedHead ||
      !Number.isSafeInteger(permit.issuedAt) || !Number.isSafeInteger(permit.expiresAt) ||
      permit.issuedAt > now || permit.expiresAt <= now ||
      permit.expiresAt <= permit.issuedAt || permit.expiresAt - permit.issuedAt > TTL) fail();
  return true;
}

// Fixed local state location. There is intentionally no Bridge operation
// that creates, replaces, or grants this permit. The local OS owner writes it.
export async function consumeLocalPermit(statePath, binding) {
  const dir = path.dirname(statePath);
  const permitPath = path.join(dir, 'worktree-create-local-permit.json');
  const digest = createHash('sha256').update(binding.requestId).digest('hex');
  const claimPath = path.join(dir, 'worktree-local-permit-claim-' + digest + '.json');
  let handle;
  try {
    await verifyDirectory(dir);
    const st = await fs.lstat(permitPath);
    if (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1 || st.size > 4096 ||
        canonical(await fs.realpath(permitPath)) !== canonical(permitPath)) fail();
    const raw = await fs.readFile(permitPath, 'utf8');
    if (Buffer.byteLength(raw) > 4096) fail();
    const permit = JSON.parse(raw.replace(/^\uFEFF/u, ''));
    validateLocalPermit(permit, binding);
    // Atomic durable claim per local permit/request, independently of approval ID.
    // Never remove a claim, including after failure or a daemon restart.
    handle = await fs.open(claimPath, 'wx', 0o600);
    await handle.writeFile(JSON.stringify({ requestId: binding.requestId,
      branch: binding.branch, expectedHead: binding.expectedHead }) + '\n', 'utf8');
    await handle.sync();
    validateLocalPermit(permit, binding);
    return Object.freeze({ expiresAt: permit.expiresAt });
  } catch { fail(); } finally { if (handle) await handle.close(); }
}
