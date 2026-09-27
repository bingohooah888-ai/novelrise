import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';

const OWNER = 'bingohooah888-ai';
const REPOSITORY = 'novelrise';
const ISSUE_NUMBER = 797;
const REQUEST_PREFIX = 'NOVELIGHT_AUTHOR_BADGE_PACK_PROBE_REQUEST ';
const RESULT_PREFIX = 'NOVELIGHT_AUTHOR_BADGE_PACK_PROBE_RESULT_V1';
const REQUEST_ID_RE = /^cmdr-[0-9]{8}T[0-9]{6}Z-[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;
const MAX_OUTPUT = 60000;

function bounded(value, limit = MAX_OUTPUT) {
  const text = String(value || '');
  return text.length <= limit ? text : text.slice(0, limit) + '\n[truncated]';
}

function token() {
  return String(process.env.NOVELIGHT_BRIDGE_GITHUB_TOKEN || '').trim();
}

async function githubApi(method, apiPath, body) {
  const auth = token();
  if (!auth) return null;
  const response = await fetch('https://api.github.com' + apiPath, {
    method,
    headers: {
      Authorization: 'Bearer ' + auth,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'NOVELIGHT-Commander-Author-Badge-Probe'
    },
    body: body == null ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000)
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status}: ${payload?.message || response.statusText}`);
  }
  return payload;
}

function parseRequest(comment) {
  if (comment?.user?.login !== OWNER || comment?.author_association !== 'OWNER') return null;
  const body = String(comment.body || '');
  if (!body.startsWith(REQUEST_PREFIX)) return null;
  const request = JSON.parse(body.slice(REQUEST_PREFIX.length));
  if (
    Object.keys(request).sort().join(',') !== 'action,args,requestId,version' ||
    request.version !== 1 ||
    request.action !== 'author_badge_pack_probe' ||
    !REQUEST_ID_RE.test(String(request.requestId || '')) ||
    !request.args ||
    Array.isArray(request.args) ||
    Object.keys(request.args).length !== 0
  ) {
    throw new Error('Author badge pack probe request does not match the fixed read-only contract.');
  }
  return request;
}

function pngGeometry(bytes) {
  if (bytes.length < 24 || bytes.toString('hex', 0, 8) !== '89504e470d0a1a0a') return null;
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20)
  };
}

async function inspectZip(filePath) {
  const bytes = await fs.readFile(filePath);
  const zip = await JSZip.loadAsync(bytes);
  const entries = Object.keys(zip.files).filter(name => !zip.files[name].dir).sort();
  const pngs = [];
  const manifests = {};
  for (const name of entries) {
    const entry = zip.file(name);
    if (!entry) continue;
    if (/\.png$/i.test(name)) {
      const image = await entry.async('nodebuffer');
      pngs.push({
        name,
        size: image.length,
        sha256: createHash('sha256').update(image).digest('hex'),
        geometry: pngGeometry(image)
      });
    } else if (/manifest\.(json|csv)$/i.test(path.basename(name))) {
      manifests[name] = await entry.async('string');
    }
  }
  return {
    file: path.basename(filePath),
    zipSize: bytes.length,
    zipSha256: createHash('sha256').update(bytes).digest('hex'),
    entryCount: entries.length,
    pngCount: pngs.length,
    entries,
    pngs,
    manifests
  };
}

async function runProbe() {
  const downloads = path.join(os.homedir(), 'Downloads');
  const rows = await fs.readdir(downloads, { withFileTypes: true });
  const candidates = [];
  for (const row of rows) {
    if (!row.isFile()) continue;
    if (!/^NOVELIGHT_Author_(Easy|Normal).*\.zip$/i.test(row.name)) continue;
    const full = path.join(downloads, row.name);
    const stat = await fs.stat(full);
    candidates.push({ full, name: row.name, mtimeMs: stat.mtimeMs });
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const inspected = [];
  for (const candidate of candidates.slice(0, 12)) {
    try {
      inspected.push(await inspectZip(candidate.full));
    } catch (error) {
      inspected.push({ file: candidate.name, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return {
    nloRoute: 'github_bridge',
    remoteDesktopCommanderDependency: false,
    downloads: downloads,
    matchingZipCount: candidates.length,
    packs: inspected
  };
}

async function postResult(request, status, details) {
  const body = [
    RESULT_PREFIX,
    '',
    `- request_id: \`${request.requestId}\``,
    '- action: `author_badge_pack_probe`',
    `- status: **${status}**`,
    `- observed_at: \`${new Date().toISOString()}\``,
    '',
    '~~~json',
    bounded(typeof details === 'string' ? details : JSON.stringify(details, null, 2)),
    '~~~'
  ].join('\n');
  await githubApi('POST', `/repos/${OWNER}/${REPOSITORY}/issues/${ISSUE_NUMBER}/comments`, { body });
}

async function processPendingRequest() {
  if (!token()) return;
  const since = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const comments = await githubApi(
    'GET',
    `/repos/${OWNER}/${REPOSITORY}/issues/${ISSUE_NUMBER}/comments?per_page=100&since=${encodeURIComponent(since)}`
  );
  const requests = [];
  for (const comment of comments || []) {
    try {
      const request = parseRequest(comment);
      if (request) requests.push({ request, commentId: Number(comment.id) });
    } catch (error) {
      console.error('[NLO author-badge-probe] invalid request:', error instanceof Error ? error.message : String(error));
    }
  }
  if (!requests.length) return;
  requests.sort((a, b) => a.commentId - b.commentId);
  const target = requests.at(-1).request;
  const completed = (comments || []).some(comment => {
    const body = String(comment.body || '');
    return body.startsWith(RESULT_PREFIX) && body.includes(`- request_id: \`${target.requestId}\``);
  });
  if (completed) return;
  try {
    await postResult(target, 'success', await runProbe());
  } catch (error) {
    await postResult(target, 'failure', error instanceof Error ? error.stack || error.message : String(error));
  }
}

void processPendingRequest().catch(error => {
  console.error('[NLO author-badge-probe] startup probe failed:', error);
});
