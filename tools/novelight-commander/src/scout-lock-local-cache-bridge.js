import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const OWNER = 'bingohooah888-ai';
const REPOSITORY = 'novelrise';
const REQUEST_PREFIX = 'NOVELIGHT_SCOUT_LOCK_CACHE_REQUEST ';
const RESULT_PREFIX = 'NOVELIGHT_SCOUT_LOCK_CACHE_RESULT_V1';
const REQUEST_ID_RE = /^cmdr-[0-9]{8}T[0-9]{6}Z-[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;
const CONFIRMATION = 'TRANSFER_SCOUT_LOCK_CACHE';
const EXPECTED_BYTES = 1843639;
const EXPECTED_SHA256 = '33b4056b430ab1bd54e0f614e1aa6f040def46da31f5fcc85a5b1ffe7c60fe98';
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
const MAX_SCAN_FILES = 30000;
const MAX_CANDIDATE_BYTES = 8 * 1024 * 1024;
const POLL_MS = 10000;
const LOOKBACK_MS = 60 * 60 * 1000;
let busy = false;

function bounded(value, limit = 10000) {
  const text = String(value || '').replace(
    /((?:TOKEN|API_KEY|SECRET|PASSWORD)\s*[=:]\s*)[^\s\"'\r\n]+/gi,
    '$1[REDACTED]'
  );
  return text.length <= limit ? text : text.slice(0, limit) + '\n[truncated]';
}

function exactKeys(value, allowed) {
  return JSON.stringify(Object.keys(value || {}).sort()) === JSON.stringify([...allowed].sort());
}

function token() {
  return String(process.env.NOVELIGHT_BRIDGE_GITHUB_TOKEN || '').trim();
}

async function loadConfig() {
  const configPath = String(process.env.NOVELIGHT_BRIDGE_CONFIG || '').trim();
  if (!configPath) throw new Error('NOVELIGHT_BRIDGE_CONFIG is not configured.');
  const raw = JSON.parse(String(await fs.readFile(path.resolve(configPath), 'utf8')).replace(/^\uFEFF/u, ''));
  if (raw.owner !== OWNER || raw.repository !== REPOSITORY) throw new Error('Bridge repository identity mismatch.');
  if (!Number.isInteger(raw.issueNumber) || raw.issueNumber < 1) throw new Error('Bridge issueNumber is invalid.');
  return { issueNumber: raw.issueNumber };
}

async function githubApi(method, apiPath, body) {
  const bearer = token();
  if (!bearer) throw new Error('NOVELIGHT_BRIDGE_GITHUB_TOKEN is missing.');
  const response = await fetch('https://api.github.com' + apiPath, {
    method,
    headers: {
      Authorization: 'Bearer ' + bearer,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'NOVELIGHT-Commander-Scout-Lock-Cache'
    },
    body: body == null ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000)
  });
  const text = await response.text();
  let payload = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = text; }
  }
  if (!response.ok) {
    const detail = payload && typeof payload === 'object' ? payload.message || JSON.stringify(payload) : String(payload || response.statusText);
    throw new Error(`GitHub API ${response.status} ${method} ${apiPath}: ${detail}`);
  }
  return payload;
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function gitBlobSha(data) {
  return crypto.createHash('sha1').update(Buffer.from(`blob ${data.length}\0`)).update(data).digest('hex');
}

function exactApproved(data) {
  return Buffer.isBuffer(data) &&
    data.length === EXPECTED_BYTES &&
    data.subarray(0, 8).equals(PNG_SIGNATURE) &&
    data.readUInt32BE(16) === 1254 &&
    data.readUInt32BE(20) === 1254 &&
    sha256(data) === EXPECTED_SHA256;
}

function extractPng(buffer, start) {
  if (!buffer.subarray(start, start + 8).equals(PNG_SIGNATURE)) return null;
  let offset = start + 8;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const typeStart = offset + 4;
    const dataEnd = typeStart + 4 + length;
    const crcEnd = dataEnd + 4;
    if (length > 64 * 1024 * 1024 || crcEnd > buffer.length) return null;
    const type = buffer.toString('ascii', typeStart, typeStart + 4);
    offset = crcEnd;
    if (type === 'IEND') return buffer.subarray(start, offset);
  }
  return null;
}

async function safeStat(candidate) {
  try { return await fs.stat(candidate); } catch { return null; }
}

async function listDirs(root) {
  try {
    return (await fs.readdir(root, { withFileTypes: true }))
      .filter(entry => entry.isDirectory())
      .map(entry => path.join(root, entry.name));
  } catch {
    return [];
  }
}

async function candidateRoots() {
  const home = os.homedir();
  const roots = [
    path.join(home, 'Downloads'),
    path.join(home, 'Desktop'),
    process.env.TEMP || '',
    process.env.TMP || ''
  ].filter(Boolean);

  const local = String(process.env.LOCALAPPDATA || '');
  for (const userData of [
    path.join(local, 'Google', 'Chrome', 'User Data'),
    path.join(local, 'Microsoft', 'Edge', 'User Data')
  ]) {
    const profiles = await listDirs(userData);
    for (const profile of profiles) {
      const base = path.basename(profile);
      if (base !== 'Default' && !/^Profile \d+$/.test(base)) continue;
      roots.push(path.join(profile, 'Cache', 'Cache_Data'));
      roots.push(path.join(profile, 'Code Cache'));
      roots.push(path.join(profile, 'Service Worker', 'CacheStorage'));
    }
  }
  return [...new Set(roots)];
}

async function scanRoot(root, state) {
  const stack = [root];
  while (stack.length && state.scanned < MAX_SCAN_FILES) {
    const current = stack.pop();
    let entries;
    try { entries = await fs.readdir(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (state.scanned >= MAX_SCAN_FILES) break;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      state.scanned += 1;
      const stat = await safeStat(full);
      if (!stat || stat.size < EXPECTED_BYTES || stat.size > MAX_CANDIDATE_BYTES) continue;
      let data;
      try { data = await fs.readFile(full); } catch { continue; }
      if (exactApproved(data)) return { data, sourceKind: 'exact-file' };
      let cursor = 0;
      while (cursor < data.length) {
        const start = data.indexOf(PNG_SIGNATURE, cursor);
        if (start < 0) break;
        const png = extractPng(data, start);
        if (png && exactApproved(png)) return { data: Buffer.from(png), sourceKind: 'browser-cache' };
        cursor = start + 8;
      }
    }
  }
  return null;
}

async function findApprovedBytes() {
  const state = { scanned: 0 };
  for (const root of await candidateRoots()) {
    const hit = await scanRoot(root, state);
    if (hit) return { ...hit, scanned: state.scanned };
  }
  throw new Error(`Approved PNG not found in local/cache scan after ${state.scanned} files.`);
}

async function transferToGithub() {
  const hit = await findApprovedBytes();
  const expectedGitSha = gitBlobSha(hit.data);
  const created = await githubApi('POST', `/repos/${OWNER}/${REPOSITORY}/git/blobs`, {
    content: hit.data.toString('base64'),
    encoding: 'base64'
  });
  if (String(created?.sha || '') !== expectedGitSha) {
    throw new Error(`GitHub blob SHA mismatch: got ${created?.sha || 'none'}, expected ${expectedGitSha}.`);
  }
  return JSON.stringify({
    result: 'BLOB_READY',
    nloRoute: 'github_bridge',
    remoteDesktopCommanderDependency: false,
    sourceKind: hit.sourceKind,
    scannedFiles: hit.scanned,
    bytes: hit.data.length,
    sha256: sha256(hit.data),
    geometry: { width: hit.data.readUInt32BE(16), height: hit.data.readUInt32BE(20) },
    imageProcessing: 'none',
    blobSha: created.sha
  }, null, 2);
}

function parseRequest(comment) {
  if (comment?.user?.login !== OWNER || comment?.author_association !== 'OWNER') return null;
  const body = String(comment?.body || '');
  if (!body.startsWith(REQUEST_PREFIX)) return null;
  const request = JSON.parse(body.slice(REQUEST_PREFIX.length));
  if (!exactKeys(request, ['version', 'requestId', 'action', 'args'])) throw new Error('Cache request keys do not match v1 contract.');
  if (request.version !== 1 || !REQUEST_ID_RE.test(String(request.requestId || ''))) throw new Error('Cache request version or requestId is invalid.');
  if (request.action !== 'transfer_scout_lock_cache') throw new Error('Unsupported cache action.');
  if (!exactKeys(request.args, ['confirmation']) || request.args.confirmation !== CONFIRMATION) throw new Error('Cache transfer confirmation mismatch.');
  return request;
}

async function postResult(config, request, status, details) {
  const body = [RESULT_PREFIX, '', `- request_id: \`${request.requestId}\``, `- action: \`${request.action}\``, `- status: **${status}**`, `- observed_at: \`${new Date().toISOString()}\``, '', '~~~text', bounded(details), '~~~'].join('\n');
  await githubApi('POST', `/repos/${OWNER}/${REPOSITORY}/issues/${config.issueNumber}/comments`, { body });
}

async function recentComments(config) {
  const since = new Date(Date.now() - LOOKBACK_MS).toISOString();
  const comments = [];
  for (let page = 1; page <= 5; page += 1) {
    const batch = await githubApi('GET', `/repos/${OWNER}/${REPOSITORY}/issues/${config.issueNumber}/comments?per_page=100&page=${page}&since=${encodeURIComponent(since)}`);
    comments.push(...(batch || []));
    if (!Array.isArray(batch) || batch.length < 100) break;
  }
  return comments;
}

async function processPendingRequests() {
  if (busy || !token()) return;
  busy = true;
  try {
    const config = await loadConfig();
    const comments = await recentComments(config);
    const completed = new Set();
    for (const comment of comments) {
      const body = String(comment?.body || '');
      if (!body.startsWith(RESULT_PREFIX)) continue;
      const match = body.match(/- request_id: `([^`]+)`/);
      if (match) completed.add(match[1]);
    }
    const pending = [];
    for (const comment of comments) {
      try {
        const request = parseRequest(comment);
        if (request && !completed.has(request.requestId)) pending.push({ request, commentId: Number(comment.id || 0) });
      } catch (error) {
        console.error('[NLO scout-lock-cache] invalid request:', error instanceof Error ? error.message : String(error));
      }
    }
    pending.sort((a, b) => a.commentId - b.commentId);
    for (const entry of pending) {
      try { await postResult(config, entry.request, 'success', await transferToGithub()); }
      catch (error) { await postResult(config, entry.request, 'failure', error instanceof Error ? error.stack || error.message : String(error)); }
    }
  } finally {
    busy = false;
  }
}

void processPendingRequests().catch(error => console.error('[NLO scout-lock-cache] startup poll failed:', error));
const timer = setInterval(() => {
  void processPendingRequests().catch(error => console.error('[NLO scout-lock-cache] poll failed:', error));
}, POLL_MS);
timer.unref?.();
