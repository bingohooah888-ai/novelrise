import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const OWNER = 'bingohooah888-ai';
const REPOSITORY = 'novelrise';
const REQUEST_PREFIX = 'NOVELIGHT_SCOUT_LOCK_DIRECT_REQUEST ';
const RESULT_PREFIX = 'NOVELIGHT_SCOUT_LOCK_DIRECT_RESULT_V1';
const REQUEST_ID_RE = /^cmdr-[0-9]{8}T[0-9]{6}Z-[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;
const CONFIRMATION = 'REGISTER_SCOUT_LOCK_DIRECT';
const EXPECTED_BYTES = 1843639;
const EXPECTED_SHA256 = '33b4056b430ab1bd54e0f614e1aa6f040def46da31f5fcc85a5b1ffe7c60fe98';
const TARGET_FILE = 'assets/scout-badges/unearned-locked.png';
const TARGET_JS = 'novelight-scout-record.js';
const TARGET_HTML = 'scout-record.html';
const TARGET_TEST = 'tests/scout-badge-concealment.test.mjs';
const POLL_MS = 10000;
const LOOKBACK_MS = 60 * 60 * 1000;
let busy = false;

function bounded(value, limit = 20000) {
  const text = String(value || '').replace(/((?:TOKEN|API_KEY|SECRET|PASSWORD)\s*[=:]\s*)[^\s\"'\r\n]+/gi, '$1[REDACTED]');
  return text.length <= limit ? text : text.slice(0, limit) + '\n[truncated]';
}

function exactKeys(value, allowed) {
  return JSON.stringify(Object.keys(value || {}).sort()) === JSON.stringify([...allowed].sort());
}

function bridgeToken() {
  return String(process.env.NOVELIGHT_BRIDGE_GITHUB_TOKEN || '').trim();
}

async function loadConfig() {
  const configPath = String(process.env.NOVELIGHT_BRIDGE_CONFIG || '').trim();
  if (!configPath) throw new Error('NOVELIGHT_BRIDGE_CONFIG is not configured.');
  const raw = JSON.parse(String(await fs.readFile(path.resolve(configPath), 'utf8')).replace(/^\uFEFF/u, ''));
  if (raw.owner !== OWNER || raw.repository !== REPOSITORY) throw new Error('Bridge repository identity mismatch.');
  if (!Number.isInteger(raw.issueNumber) || raw.issueNumber < 1) throw new Error('Bridge issueNumber is invalid.');
  return { issueNumber: raw.issueNumber, repoRoot: path.resolve(String(raw.repoRoot || '')) };
}

async function githubApi(method, apiPath, body) {
  const token = bridgeToken();
  if (!token) throw new Error('NOVELIGHT_BRIDGE_GITHUB_TOKEN is missing.');
  const response = await fetch('https://api.github.com' + apiPath, {
    method,
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'NOVELIGHT-Commander-Scout-Lock-Direct'
    },
    body: body == null ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000)
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

function run(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd || process.cwd(),
      shell: false,
      windowsHide: true,
      env: process.env
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      child.kill();
      if (!settled) {
        settled = true;
        reject(new Error(`Process timed out after ${options.timeoutMs || 120000}ms.`));
      }
    }, options.timeoutMs || 120000);
    child.stdout?.on('data', chunk => { stdout = bounded(stdout + chunk.toString()); });
    child.stderr?.on('data', chunk => { stderr = bounded(stderr + chunk.toString()); });
    child.on('error', error => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        resolve({ code, stdout, stderr });
      }
    });
  });
}

async function git(config, args, options = {}) {
  const result = await run('git', args, { cwd: options.cwd || config.repoRoot, timeoutMs: options.timeoutMs || 120000 });
  if (result.code !== 0) throw new Error(`git ${args.join(' ')} failed.\n${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

function approvedPng(data) {
  if (!Buffer.isBuffer(data) || data.length !== EXPECTED_BYTES) return false;
  if (data.length < 24 || data.toString('hex', 0, 8) !== '89504e470d0a1a0a') return false;
  if (data.readUInt32BE(16) !== 1254 || data.readUInt32BE(20) !== 1254) return false;
  return crypto.createHash('sha256').update(data).digest('hex') === EXPECTED_SHA256;
}

async function findApprovedDownload() {
  const downloads = path.join(os.homedir(), 'Downloads');
  const entries = await fs.readdir(downloads, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const candidate = path.join(downloads, entry.name);
    let stat;
    try { stat = await fs.stat(candidate); } catch { continue; }
    if (stat.size !== EXPECTED_BYTES) continue;
    let data;
    try { data = await fs.readFile(candidate); } catch { continue; }
    if (approvedPng(data)) return { data, fileName: entry.name };
  }
  throw new Error('Approved 1254x1254 SCOUT lock PNG was not found in Downloads.');
}

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`Unable to patch ${label}: expected source was not found.`);
  return source.replace(before, after);
}

async function patchProduct(worktree, asset) {
  const jsPath = path.join(worktree, TARGET_JS);
  let js = await fs.readFile(jsPath, 'utf8');
  js = replaceOnce(js, "  const badgeArtworkPaths = {", "  const unearnedBadgeArtworkPath = 'assets/scout-badges/unearned-locked.png';\n  const badgeArtworkPaths = {", 'lock artwork constant');
  js = replaceOnce(js, "  function createBadgeIcon(row) {\n    const icon = document.createElement('div');", "  function badgeArtworkPath(row) {\n    if (row.status !== 'earned') return unearnedBadgeArtworkPath;\n    return badgeArtworkPaths[row.badge_id] || '';\n  }\n\n  function createBadgeIcon(row) {\n    const icon = document.createElement('div');", 'badge artwork selector');
  js = replaceOnce(js, "    const artworkPath = badgeArtworkPaths[row.badge_id];\n    if (!artworkPath) {", "    const artworkPath = badgeArtworkPath(row);\n    if (!artworkPath) {", 'badge card artwork path');
  js = replaceOnce(js, "    icon.classList.add('badge-icon-artwork');\n    const image = document.createElement('img');", "    icon.classList.add('badge-icon-artwork');\n    if (row.status !== 'earned') icon.classList.add('badge-icon-locked');\n    const image = document.createElement('img');", 'badge locked class');
  js = replaceOnce(
    js,
    "    image.removeAttribute('src');\n    image.alt = '';\n\n    const artworkPath = badgeArtworkPaths[row.badge_id];\n    host.hidden = !artworkPath;\n    if (!artworkPath) return;\n\n    image.src = artworkPath;\n    image.alt = `${badgeDisplayName(row)} 称号紋章`;",
    "    image.removeAttribute('src');\n    image.alt = '';\n    host.removeAttribute('data-badge-locked');\n\n    const earned = row.status === 'earned';\n    const artworkPath = badgeArtworkPath(row);\n    host.hidden = !artworkPath;\n    if (!artworkPath) return;\n\n    host.dataset.badgeLocked = String(!earned);\n    image.src = artworkPath;\n    image.alt = earned\n      ? `${badgeDisplayName(row)} 称号紋章`\n      : '未獲得称号。正式な称号紋章は獲得後に開示されます';",
    'badge dialog artwork path'
  );
  await fs.writeFile(jsPath, js, 'utf8');

  const htmlPath = path.join(worktree, TARGET_HTML);
  let html = await fs.readFile(htmlPath, 'utf8');
  html = replaceOnce(
    html,
    '読者称号・作者称号・限定称号を同じアカウントで収集します。未獲得称号も進捗を表示します。',
    '読者称号・作者称号・限定称号を同じアカウントで収集します。未獲得称号も進捗を表示しますが、正式な称号紋章は獲得後に初めて開示されます。',
    'SCOUT RECORD explanatory copy'
  );
  await fs.writeFile(htmlPath, html, 'utf8');

  await fs.mkdir(path.dirname(path.join(worktree, TARGET_FILE)), { recursive: true });
  await fs.writeFile(path.join(worktree, TARGET_FILE), asset.data);

  const testSource = `import assert from 'node:assert/strict';\nimport { createHash } from 'node:crypto';\nimport { readFileSync } from 'node:fs';\nimport test from 'node:test';\n\nconst source = readFileSync(new URL('../novelight-scout-record.js', import.meta.url), 'utf8');\nconst artwork = readFileSync(new URL('../assets/scout-badges/unearned-locked.png', import.meta.url));\n\ntest('unearned SCOUT badges hide canonical artwork until earned', () => {\n  assert.match(source, /const unearnedBadgeArtworkPath = 'assets\\/scout-badges\\/unearned-locked\\.png';/);\n  assert.match(source, /function badgeArtworkPath\\(row\\) \\{[\\s\\S]*?row\\.status !== 'earned'[\\s\\S]*?return unearnedBadgeArtworkPath;[\\s\\S]*?badgeArtworkPaths\\[row\\.badge_id\\]/);\n  assert.match(source, /function createBadgeIcon\\(row\\) \\{[\\s\\S]*?badgeArtworkPath\\(row\\)/);\n  assert.match(source, /function renderBadgeDialogArtwork\\(row\\) \\{[\\s\\S]*?badgeArtworkPath\\(row\\)/);\n});\n\ntest('approved lock artwork remains byte-exact 1254x1254 PNG', () => {\n  assert.equal(artwork.toString('hex', 0, 8), '89504e470d0a1a0a');\n  assert.equal(artwork.readUInt32BE(16), 1254);\n  assert.equal(artwork.readUInt32BE(20), 1254);\n  assert.equal(artwork.length, ${EXPECTED_BYTES});\n  assert.equal(createHash('sha256').update(artwork).digest('hex'), '${EXPECTED_SHA256}');\n});\n`;
  await fs.writeFile(path.join(worktree, TARGET_TEST), testSource, 'utf8');
}

async function actionRegister(request, config) {
  if (!exactKeys(request.args, ['confirmation'])) throw new Error('direct register requires exactly confirmation.');
  if (request.args.confirmation !== CONFIRMATION) throw new Error('Direct register confirmation mismatch.');

  const asset = await findApprovedDownload();
  await git(config, ['fetch', 'origin', 'main', '--prune']);
  const shortId = request.requestId.replace(/^cmdr-/, '').replace(/[^A-Za-z0-9_-]/g, '-').slice(-36);
  const branch = `fix/scout-lock-final-${shortId}`;
  const worktree = path.join(os.tmpdir(), `novelight-scout-lock-direct-${shortId}`);
  await fs.rm(worktree, { recursive: true, force: true });
  await git(config, ['worktree', 'add', '-b', branch, worktree, 'origin/main']);
  try {
    await patchProduct(worktree, asset);
    const targeted = await run(process.execPath, ['--test', TARGET_TEST], { cwd: worktree, timeoutMs: 120000 });
    if (targeted.code !== 0) throw new Error(`Targeted lock test failed.\n${targeted.stderr || targeted.stdout}`);
    await git(config, ['diff', '--check'], { cwd: worktree });

    const changed = (await git(config, ['status', '--porcelain'], { cwd: worktree })).split(/\r?\n/).filter(Boolean);
    const paths = changed.map(line => line.slice(3).replace(/\\/g, '/')).sort();
    const expectedPaths = [TARGET_FILE, TARGET_HTML, TARGET_JS, TARGET_TEST].sort();
    if (JSON.stringify(paths) !== JSON.stringify(expectedPaths)) throw new Error(`Unexpected changed files: ${paths.join(', ')}`);

    await git(config, ['add', '--', ...expectedPaths], { cwd: worktree });
    await git(config, ['-c', 'user.name=NOVELIGHT Commander', '-c', 'user.email=nlo@novelight.local', 'commit', '-m', 'Hide unearned SCOUT badge artwork'], { cwd: worktree });
    const headSha = await git(config, ['rev-parse', 'HEAD'], { cwd: worktree });
    await git(config, ['push', 'origin', `HEAD:refs/heads/${branch}`], { cwd: worktree, timeoutMs: 600000 });

    return JSON.stringify({
      result: 'BRANCH_PUSHED',
      nloRoute: 'github_bridge',
      remoteDesktopCommanderDependency: false,
      source: path.join('Downloads', asset.fileName),
      sourceBytes: asset.data.length,
      sourceSha256: crypto.createHash('sha256').update(asset.data).digest('hex'),
      geometry: { width: asset.data.readUInt32BE(16), height: asset.data.readUInt32BE(20) },
      imageProcessing: 'none',
      changedFiles: expectedPaths,
      targetedTest: 'PASS',
      branch,
      headSha,
      productionMerged: false
    }, null, 2);
  } finally {
    await git(config, ['worktree', 'remove', '--force', worktree]).catch(() => {});
    await git(config, ['branch', '-D', branch]).catch(() => {});
  }
}

function parseRequest(comment) {
  if (comment?.user?.login !== OWNER || comment?.author_association !== 'OWNER') return null;
  const body = String(comment?.body || '');
  if (!body.startsWith(REQUEST_PREFIX)) return null;
  const request = JSON.parse(body.slice(REQUEST_PREFIX.length));
  if (!exactKeys(request, ['version', 'requestId', 'action', 'args'])) throw new Error('Direct request keys do not match v1 contract.');
  if (request.version !== 1 || !REQUEST_ID_RE.test(String(request.requestId || ''))) throw new Error('Direct request version or requestId is invalid.');
  if (request.action !== 'scout_lock_direct_register') throw new Error('Unsupported direct SCOUT lock action.');
  if (!request.args || typeof request.args !== 'object' || Array.isArray(request.args)) throw new Error('Direct request args must be an object.');
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
  if (busy || !bridgeToken()) return;
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
        console.error('[NLO scout-lock-direct] invalid request:', error instanceof Error ? error.message : String(error));
      }
    }
    pending.sort((a, b) => a.commentId - b.commentId);
    for (const entry of pending) {
      try { await postResult(config, entry.request, 'success', await actionRegister(entry.request, config)); }
      catch (error) { await postResult(config, entry.request, 'failure', error instanceof Error ? error.stack || error.message : String(error)); }
    }
  } finally {
    busy = false;
  }
}

void processPendingRequests().catch(error => console.error('[NLO scout-lock-direct] startup poll failed:', error));
const timer = setInterval(() => {
  void processPendingRequests().catch(error => console.error('[NLO scout-lock-direct] poll failed:', error));
}, POLL_MS);
timer.unref?.();
