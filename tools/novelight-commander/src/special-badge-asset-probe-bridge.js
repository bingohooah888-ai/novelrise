import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';

const OWNER = 'bingohooah888-ai';
const REPOSITORY = 'novelrise';
const ISSUE_NUMBER = 797;
const REQUEST_PREFIX = 'NOVELIGHT_SPECIAL_BADGE_ASSET_PROBE_REQUEST ';
const RESULT_PREFIX = 'NOVELIGHT_SPECIAL_BADGE_ASSET_PROBE_RESULT_V1';
const REQUEST_ID_RE = /^cmdr-[0-9]{8}T[0-9]{6}Z-[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;
const MAX_OUTPUT = 60000;
const MAX_DEPTH = 6;
const MAX_VISITED_FILES = 20000;
const MAX_CANDIDATES = 300;
const RECENT_WINDOW_MS = 21 * 24 * 60 * 60 * 1000;
const KEYWORDS_RE = /novelight|light[ _-]?seed|badge|beta|rank|scout|bronze|silver|gold/i;
const EXT_RE = /\.(png|webp|jpe?g|zip)$/i;

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
      'User-Agent': 'NOVELIGHT-Commander-Special-Badge-Asset-Probe'
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
    request.action !== 'special_badge_asset_probe' ||
    !REQUEST_ID_RE.test(String(request.requestId || '')) ||
    !request.args ||
    Array.isArray(request.args) ||
    Object.keys(request.args).length !== 0
  ) {
    throw new Error('Special badge asset probe request does not match the fixed read-only contract.');
  }
  return request;
}

function pngGeometry(bytes) {
  if (bytes.length < 24 || bytes.toString('hex', 0, 8) !== '89504e470d0a1a0a') return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

async function inspectFile(candidate) {
  const bytes = await fs.readFile(candidate.full);
  const result = {
    root: candidate.rootName,
    relativePath: candidate.relative,
    file: path.basename(candidate.full),
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    modifiedAt: candidate.stat.mtime.toISOString(),
    keywordMatch: candidate.keywordMatch,
    recent: candidate.recent
  };
  if (/\.png$/i.test(candidate.full)) result.geometry = pngGeometry(bytes);
  if (/\.zip$/i.test(candidate.full)) {
    try {
      const zip = await JSZip.loadAsync(bytes);
      const entries = Object.keys(zip.files).filter(name => !zip.files[name].dir).sort();
      const interestingEntries = entries.filter(name => KEYWORDS_RE.test(name) || /manifest\.(json|csv)$/i.test(path.basename(name)));
      const manifests = {};
      for (const name of entries) {
        if (!/manifest\.(json|csv)$/i.test(path.basename(name))) continue;
        const entry = zip.file(name);
        if (entry) manifests[name] = bounded(await entry.async('string'), 12000);
      }
      result.zip = { entryCount: entries.length, interestingEntries: interestingEntries.slice(0, 100), manifests };
    } catch (error) {
      result.zipError = error instanceof Error ? error.message : String(error);
    }
  }
  return result;
}

async function collectFromRoot(rootName, rootPath, candidates, state) {
  async function walk(current, depth) {
    if (depth > MAX_DEPTH || state.visitedFiles >= MAX_VISITED_FILES || candidates.length >= MAX_CANDIDATES) return;
    let rows;
    try { rows = await fs.readdir(current, { withFileTypes: true }); } catch { return; }
    for (const row of rows) {
      if (state.visitedFiles >= MAX_VISITED_FILES || candidates.length >= MAX_CANDIDATES) return;
      if (row.isSymbolicLink()) continue;
      const full = path.join(current, row.name);
      if (row.isDirectory()) {
        if (depth < MAX_DEPTH) await walk(full, depth + 1);
        continue;
      }
      if (!row.isFile() || !EXT_RE.test(row.name)) continue;
      state.visitedFiles += 1;
      let stat;
      try { stat = await fs.stat(full); } catch { continue; }
      const relative = path.relative(rootPath, full);
      const keywordMatch = KEYWORDS_RE.test(relative);
      const recent = Date.now() - stat.mtimeMs <= RECENT_WINDOW_MS;
      if (!keywordMatch && !recent) continue;
      candidates.push({ rootName, full, relative, stat, keywordMatch, recent });
    }
  }
  await walk(rootPath, 0);
}

async function runProbe() {
  const home = os.homedir();
  const roots = [
    ['Downloads', path.join(home, 'Downloads')],
    ['Desktop', path.join(home, 'Desktop')],
    ['Documents', path.join(home, 'Documents')]
  ];
  const candidates = [];
  const state = { visitedFiles: 0 };
  for (const [rootName, rootPath] of roots) await collectFromRoot(rootName, rootPath, candidates, state);
  candidates.sort((a, b) => a.keywordMatch !== b.keywordMatch ? (a.keywordMatch ? -1 : 1) : b.stat.mtimeMs - a.stat.mtimeMs);
  const inspected = [];
  for (const candidate of candidates.slice(0, MAX_CANDIDATES)) {
    try {
      inspected.push(await inspectFile(candidate));
    } catch (error) {
      inspected.push({
        root: candidate.rootName,
        relativePath: candidate.relative,
        file: path.basename(candidate.full),
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return {
    nloRoute: 'github_bridge',
    remoteDesktopCommanderDependency: false,
    readOnly: true,
    allowedRoots: roots.map(([name]) => name),
    maxDepth: MAX_DEPTH,
    maxVisitedFiles: MAX_VISITED_FILES,
    maxCandidates: MAX_CANDIDATES,
    recentWindowDays: RECENT_WINDOW_MS / (24 * 60 * 60 * 1000),
    visitedFiles: state.visitedFiles,
    candidateCount: candidates.length,
    candidates: inspected
  };
}

async function postResult(request, status, details) {
  const body = [
    RESULT_PREFIX,
    '',
    `- request_id: \`${request.requestId}\``,
    '- action: `special_badge_asset_probe`',
    `- status: **${status}**`,
    `- observed_at: \`${new Date().toISOString()}\``,
    '',
    '~~~json',
    bounded(typeof details === 'string' ? details : JSON.stringify(details, null, 2)),
    '~~~'
  ].join('\n');
  await githubApi('POST', `/repos/${OWNER}/${REPOSITORY}/issues/${ISSUE_NUMBER}/comments`, { body });
}

async function listRecentComments() {
  const since = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const comments = [];
  for (let page = 1; page <= 10; page += 1) {
    const batch = await githubApi(
      'GET',
      `/repos/${OWNER}/${REPOSITORY}/issues/${ISSUE_NUMBER}/comments?per_page=100&page=${page}&since=${encodeURIComponent(since)}`
    );
    comments.push(...(batch || []));
    if (!batch || batch.length < 100) break;
  }
  return comments;
}

async function processPendingRequest() {
  if (!token()) return;
  const comments = await listRecentComments();
  const requests = [];
  for (const comment of comments || []) {
    try {
      const request = parseRequest(comment);
      if (request) requests.push({ request, commentId: Number(comment.id) });
    } catch (error) {
      console.error('[NLO special-badge-asset-probe] invalid request:', error instanceof Error ? error.message : String(error));
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
  console.error('[NLO special-badge-asset-probe] startup probe failed:', error);
});
