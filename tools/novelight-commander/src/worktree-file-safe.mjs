// Existing worktree edit operation, with pinned bytes and physical path guards.
// Trust boundary: other processes with the same local OS user are not isolated.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
const MAX = 256 * 1024;
const deny = () => { throw new Error('NLO_FILE_EDIT_DENIED'); };
const norm = p => process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p);
const forbidden = new Set(['.git','.github','node_modules','.ssh','.aws','.gnupg','.vercel','.supabase','.npmrc','.netrc','.gitconfig']);

export function validatePhysicalEditPath(relative) {
  if (typeof relative !== 'string' || relative.length > 512 || relative.includes('\\')) deny();
  const parts = relative.split('/');
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (!part || part === '.' || part === '..' || /[<>:"|?*\x00-\x1f]/u.test(part) || /[. ]$/u.test(part) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part) ||
        forbidden.has(lower) || lower.startsWith('.env') || /\.(?:pem|key|pfx|p12)$/iu.test(part)) deny();
  }
  return parts;
}

async function lstatMaybe(p) {
  try { return await fs.lstat(p); } catch (e) { if (e?.code === 'ENOENT') return null; throw e; }
}
async function plainDirectory(p) {
  const st = await fs.lstat(p);
  if (!st.isDirectory() || st.isSymbolicLink() || norm(await fs.realpath(p)) !== norm(p)) deny();
}
function gitBlob(bytes) {
  return createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
}
async function pinnedFile(file, expected) {
  const st = await lstatMaybe(file);
  if (expected === null) { if (st) deny(); return null; }
  if (!st?.isFile() || st.isSymbolicLink() || st.nlink !== 1 || st.size > MAX ||
      norm(await fs.realpath(file)) !== norm(file)) deny();
  const bytes = await fs.readFile(file);
  if (bytes.length > MAX || gitBlob(bytes) !== expected) deny();
  return st;
}

export async function writePinnedWorktreeFile({ root, relative, expectedBlobSha, content }) {
  let tmp;
  try {
    const parts = validatePhysicalEditPath(relative);
    if (!path.isAbsolute(root) || !Buffer.isBuffer(content) || content.length < 1 || content.length > MAX ||
        (expectedBlobSha !== null && !/^[a-f0-9]{40}$/u.test(expectedBlobSha))) deny();
    await plainDirectory(root);
    let parent = root;
    for (const part of parts.slice(0,-1)) {
      parent = path.join(parent,part);
      if (!(await lstatMaybe(parent))) {
        if (expectedBlobSha !== null) deny();
        await fs.mkdir(parent);
      }
      await plainDirectory(parent);
    }
    const file = path.join(parent,parts.at(-1));
    const before = await pinnedFile(file,expectedBlobSha);
    tmp = path.join(parent,'.nlo-file-edit-' + randomUUID() + '.tmp');
    const handle = await fs.open(tmp,'wx',before ? before.mode & 0o777 : 0o644);
    try { await handle.writeFile(content); await handle.sync(); }
    finally { await handle.close(); }
    await plainDirectory(parent);
    const again = await pinnedFile(file,expectedBlobSha);
    if (before && (!again || before.ino !== again.ino || before.dev !== again.dev)) deny();
    if (before) await fs.rename(tmp,file);
    else { await fs.link(tmp,file); await fs.unlink(tmp); }
    tmp = undefined;
    const written = await fs.readFile(file);
    if (!written.equals(content)) deny();
    return { bytes: written.length };
  } catch { deny(); }
  finally { if (tmp) await fs.unlink(tmp).catch(() => {}); }
}
