import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

const OWNER = 'bingohooah888-ai';
const REPOSITORY = 'novelrise';
const ISSUE_NUMBER = 797;
const REQUEST_PREFIX = 'NOVELIGHT_SCOUT_SPECIAL_EXACT_PROBE_REQUEST ';
const RESULT_PREFIX = 'NOVELIGHT_SCOUT_SPECIAL_EXACT_PROBE_RESULT_V1';
const REQUEST_ID_RE = /^cmdr-[0-9]{8}T[0-9]{6}Z-[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;
const MAX_DEPTH = 8;
const MAX_VISITED_FILES = 100000;

const EXPECTED = [
  { role: 'BRONZE', file: 'BRONZE_LIGHT_SEED_MASTER_1536.png', size: 1874839, sha256: '93f84010d47a0848be102f738383a89e4815238fde703f9f8c1666bfcf7e3a90' },
  { role: 'SILVER', file: 'SILVER_LIGHT_SEED_MASTER_1536_FINAL.png', size: 1941390, sha256: '6aaf6a7a264545ed8592719228ee80d00e372d6851e3954395c31d1ea6aa981e' },
  { role: 'GOLD', file: 'NOVELIGHT_LIGHT_SEED_GOLD_1536.png', size: 1933934, sha256: '61a2f6b1a1fa2990267f2435f2a3e1e4328c90472c9a1f7e4c029986ad168e68' },
  { role: 'BETA', file: 'NOVELIGHT_BETA_BADGE_MASTER_1536.png', size: 3187364, sha256: 'f503aeaf0f5d22f8ec0a4dbe3ccab257c4744e02be02061160755e3050ff4a3c' }
];
const EXPECTED_BY_SIZE = new Map(EXPECTED.map(row => [row.size, row]));

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
      'User-Agent': 'NOVELIGHT-Commander-Scout-Special-Exact-Probe'
    },
    body: body == null ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000)
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${payload?.message || response.statusText}`);
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
    request.action !== 'scout_special_exact_probe' ||
    !REQUEST_ID_RE.test(String(request.requestId || '')) ||
    !request.args || Array.isArray(request.args) || Object.keys(request.args).length !== 0
  ) throw new Error('Exact SCOUT special probe request does not match the fixed read-only contract.');
  return request;
}

function pngGeometry(bytes) {
  if (bytes.length < 24 || bytes.toString('hex', 0, 8) !== '89504e470d0a1a0a') return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

async function runProbe() {
  const home = os.homedir();
  const roots = [
    ['Downloads', path.join(home, 'Downloads')],
    ['Desktop', path.join(home, 'Desktop')],
    ['Documents', path.join(home, 'Documents')]
  ];
  const matches = [];
  let visitedFiles = 0;

  async function walk(rootName, rootPath, current, depth) {
    if (depth > MAX_DEPTH || visitedFiles >= MAX_VISITED_FILES || matches.length >= EXPECTED.length) return;
    let rows;
    try { rows = await fs.readdir(current, { withFileTypes: true }); } catch { return; }
    for (const row of rows) {
      if (visitedFiles >= MAX_VISITED_FILES || matches.length >= EXPECTED.length) return;
      if (row.isSymbolicLink()) continue;
      const full = path.join(current, row.name);
      if (row.isDirectory()) {
        if (depth < MAX_DEPTH && row.name !== 'node_modules' && row.name !== '.git') await walk(rootName, rootPath, full, depth + 1);
        continue;
      }
      if (!row.isFile() || !/\.png$/i.test(row.name)) continue;
      visitedFiles += 1;
      let stat;
      try { stat = await fs.stat(full); } catch { continue; }
      const expected = EXPECTED_BY_SIZE.get(stat.size);
      if (!expected || matches.some(match => match.role === expected.role)) continue;
      let bytes;
      try { bytes = await fs.readFile(full); } catch { continue; }
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      if (sha256 !== expected.sha256) continue;
      const geometry = pngGeometry(bytes);
      if (!geometry || geometry.width !== 1536 || geometry.height !== 1536) continue;
      matches.push({
        role: expected.role,
        expectedFile: expected.file,
        root: rootName,
        relativePath: path.relative(rootPath, full),
        actualFile: path.basename(full),
        size: bytes.length,
        sha256,
        geometry
      });
    }
  }

  for (const [rootName, rootPath] of roots) await walk(rootName, rootPath, rootPath, 0);
  const found = new Set(matches.map(match => match.role));
  return {
    nloRoute: 'github_bridge',
    remoteDesktopCommanderDependency: false,
    readOnly: true,
    allowedRoots: roots.map(([name]) => name),
    visitedFiles,
    expectedCount: EXPECTED.length,
    matchCount: matches.length,
    complete: matches.length === EXPECTED.length,
    matches: matches.sort((a, b) => a.role.localeCompare(b.role)),
    missing: EXPECTED.filter(row => !found.has(row.role)).map(row => row.role)
  };
}

async function postResult(request, status, details) {
  const body = [
    RESULT_PREFIX, '',
    `- request_id: \`${request.requestId}\``,
    '- action: `scout_special_exact_probe`',
    `- status: **${status}**`,
    `- observed_at: \`${new Date().toISOString()}\``,
    '', '~~~json',
    typeof details === 'string' ? details : JSON.stringify(details, null, 2),
    '~~~'
  ].join('\n');
  await githubApi('POST', `/repos/${OWNER}/${REPOSITORY}/issues/${ISSUE_NUMBER}/comments`, { body });
}

async function listRecentComments() {
  const since = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const comments = [];
  for (let page = 1; page <= 10; page += 1) {
    const batch = await githubApi('GET', `/repos/${OWNER}/${REPOSITORY}/issues/${ISSUE_NUMBER}/comments?per_page=100&page=${page}&since=${encodeURIComponent(since)}`);
    comments.push(...(batch || []));
    if (!batch || batch.length < 100) break;
  }
  return comments;
}

async function processPendingRequest() {
  if (!token()) return;
  const comments = await listRecentComments();
  const requests = [];
  for (const comment of comments) {
    try {
      const request = parseRequest(comment);
      if (request) requests.push({ request, commentId: Number(comment.id) });
    } catch (error) {
      console.error('[NLO scout-special-exact-probe] invalid request:', error instanceof Error ? error.message : String(error));
    }
  }
  if (!requests.length) return;
  requests.sort((a, b) => a.commentId - b.commentId);
  const target = requests.at(-1).request;
  const completed = comments.some(comment => String(comment.body || '').startsWith(RESULT_PREFIX) && String(comment.body || '').includes(`- request_id: \`${target.requestId}\``));
  if (completed) return;
  try { await postResult(target, 'success', await runProbe()); }
  catch (error) { await postResult(target, 'failure', error instanceof Error ? error.stack || error.message : String(error)); }
}

void processPendingRequest().catch(error => {
  console.error('[NLO scout-special-exact-probe] startup failed:', error);
});
