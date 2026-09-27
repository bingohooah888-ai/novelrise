import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import JSZip from 'jszip';

const execFileAsync = promisify(execFile);
const OWNER = 'bingohooah888-ai';
const REPOSITORY = 'novelrise';
const ISSUE_NUMBER = 797;
const REQUEST_PREFIX = 'NOVELIGHT_AUTHOR_BADGE_REGISTER22_REQUEST ';
const RESULT_PREFIX = 'NOVELIGHT_AUTHOR_BADGE_REGISTER22_RESULT_V1';
const CONFIRMATION = 'REGISTER_AUTHOR_NORMAL_09_30';
const REQUEST_ID_RE = /^cmdr-[0-9]{8}T[0-9]{6}Z-[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../..');
const SOURCE_ZIP = path.join(os.homedir(), 'Downloads', 'NOVELIGHT_Author_Normal_30_images.zip');
const TARGETS = [
  ['Author_Normal_009.png', 'author_chars_250k'],
  ['Author_Normal_010.png', 'author_chars_500k'],
  ['Author_Normal_011.png', 'author_completed_001'],
  ['Author_Normal_012.png', 'author_completed_003'],
  ['Author_Normal_013.png', 'author_completed_005'],
  ['Author_Normal_014.png', 'author_novel_002'],
  ['Author_Normal_015.png', 'author_novel_005'],
  ['Author_Normal_016.png', 'author_novel_010'],
  ['Author_Normal_017.png', 'author_unique_reader_010'],
  ['Author_Normal_018.png', 'author_unique_reader_050'],
  ['Author_Normal_019.png', 'author_unique_reader_100'],
  ['Author_Normal_020.png', 'author_unique_reader_500'],
  ['Author_Normal_021.png', 'author_favorite_010'],
  ['Author_Normal_022.png', 'author_favorite_050'],
  ['Author_Normal_023.png', 'author_favorite_100'],
  ['Author_Normal_024.png', 'author_comment_010'],
  ['Author_Normal_025.png', 'author_comment_050'],
  ['Author_Normal_026.png', 'author_seed_received_001'],
  ['Author_Normal_027.png', 'author_seed_received_010'],
  ['Author_Normal_028.png', 'author_seed_received_050'],
  ['Author_Normal_029.png', 'author_discovered_plus2_001'],
  ['Author_Normal_030.png', 'author_discovered_plus3_001']
];

function token() { return String(process.env.NOVELIGHT_BRIDGE_GITHUB_TOKEN || '').trim(); }
async function githubApi(method, apiPath, body) {
  const response = await fetch('https://api.github.com' + apiPath, {
    method,
    headers: {
      Authorization: 'Bearer ' + token(),
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'NOVELIGHT-Commander-Author-Badge-Register22'
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
    request.version !== 1 || request.action !== 'author_badge_register22' ||
    !REQUEST_ID_RE.test(String(request.requestId || '')) ||
    request?.args?.confirmation !== CONFIRMATION ||
    Object.keys(request.args || {}).sort().join(',') !== 'confirmation'
  ) throw new Error('Author badge register22 request does not match the fixed contract.');
  return request;
}
async function git(args, cwd = REPO_ROOT) {
  const { stdout = '', stderr = '' } = await execFileAsync('git', args, { cwd, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  return { stdout: String(stdout).trim(), stderr: String(stderr).trim() };
}
function pngGeometry(bytes) {
  if (bytes.length < 24 || bytes.toString('hex', 0, 8) !== '89504e470d0a1a0a') throw new Error('Invalid PNG');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}
async function loadTargets() {
  const zipBytes = await fs.readFile(SOURCE_ZIP);
  const zip = await JSZip.loadAsync(zipBytes);
  const rows = [];
  for (const [fileName, badgeId] of TARGETS) {
    const entry = zip.file(fileName);
    if (!entry) throw new Error(`Source ZIP missing ${fileName}`);
    const bytes = await entry.async('nodebuffer');
    const geometry = pngGeometry(bytes);
    if (geometry.width !== 1254 || geometry.height !== 1254) {
      throw new Error(`${fileName} unexpected geometry ${geometry.width}x${geometry.height}`);
    }
    rows.push({ fileName, badgeId, bytes, sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length, ...geometry });
  }
  return { rows, zipSha256: createHash('sha256').update(zipBytes).digest('hex') };
}
function insertMappings(scriptText, rows) {
  const start = scriptText.indexOf('const badgeArtworkPaths = {');
  if (start < 0) throw new Error('badgeArtworkPaths object not found');
  const close = scriptText.indexOf('\n  };', start);
  if (close < 0) throw new Error('badgeArtworkPaths closing marker not found');
  let objectText = scriptText.slice(start, close);
  const additions = [];
  for (const row of rows) {
    const expected = `assets/scout-badges/${row.badgeId}.png`;
    const existingPattern = new RegExp(`\\n\\s*${row.badgeId}:\\s*['\"]([^'\"]+)['\"]`);
    const match = objectText.match(existingPattern);
    if (match) {
      if (match[1] !== expected) throw new Error(`${row.badgeId} already mapped to unexpected ${match[1]}`);
      continue;
    }
    additions.push(`    ${row.badgeId}: '${expected}'`);
  }
  if (!additions.length) return scriptText;
  const beforeClose = scriptText.slice(0, close).replace(/([^,\s])\s*$/, '$1,');
  return beforeClose + '\n' + additions.join(',\n') + scriptText.slice(close);
}
function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
function buildManifest(rows, zipSha256) {
  const lines = ['order,source_file,badge_id,asset_path,sha256,size_bytes,width,height,source_zip_sha256'];
  rows.forEach((row, index) => lines.push([
    index + 9,
    row.fileName,
    row.badgeId,
    `assets/scout-badges/${row.badgeId}.png`,
    row.sha256,
    row.size,
    row.width,
    row.height,
    zipSha256
  ].map(csvEscape).join(',')));
  return lines.join('\n') + '\n';
}
function buildTest(rows) {
  const expected = rows.map(row => `  ['${row.badgeId}', '${row.sha256}']`).join(',\n');
  return `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport fs from 'node:fs';\nimport crypto from 'node:crypto';\n\nconst expected = [\n${expected}\n];\n\ntest('Author Normal #9-#30 artwork keeps approved bytes and UI mappings', () => {\n  const script = fs.readFileSync('novelight-scout-record.js', 'utf8');\n  assert.equal(expected.length, 22);\n  for (const [badgeId, expectedSha] of expected) {\n    const file = \\`assets/scout-badges/\\${badgeId}.png\\`;\n    const bytes = fs.readFileSync(file);\n    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', badgeId);\n    assert.equal(bytes.readUInt32BE(16), 1254, badgeId);\n    assert.equal(bytes.readUInt32BE(20), 1254, badgeId);\n    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), expectedSha, badgeId);\n    assert.ok(script.includes(\\`${badgeId}: 'assets/scout-badges/\\${badgeId}.png'\\`), badgeId);\n  }\n});\n`;
}
async function stage(request) {
  const { rows, zipSha256 } = await loadTargets();
  await git(['fetch', 'origin', 'main']);
  const branch = `feat/scout-author-normal-09-30-${request.requestId.slice(5, 20).replace('T', '-')}`;
  const remote = await git(['ls-remote', '--heads', 'origin', branch]);
  if (remote.stdout) throw new Error(`Remote branch already exists: ${branch}`);
  const worktree = path.join(os.tmpdir(), `novelight-author-badge-${request.requestId}`);
  await fs.rm(worktree, { recursive: true, force: true });
  await git(['worktree', 'add', '-b', branch, worktree, 'origin/main']);
  try {
    const assetDir = path.join(worktree, 'assets', 'scout-badges');
    await fs.mkdir(assetDir, { recursive: true });
    for (const row of rows) {
      const target = path.join(assetDir, `${row.badgeId}.png`);
      try {
        const existing = await fs.readFile(target);
        const existingSha = createHash('sha256').update(existing).digest('hex');
        if (existingSha !== row.sha256) throw new Error(`${row.badgeId} existing asset hash mismatch`);
      } catch (error) {
        if (error?.code === 'ENOENT') await fs.writeFile(target, row.bytes);
        else throw error;
      }
    }
    const scriptPath = path.join(worktree, 'novelight-scout-record.js');
    const script = await fs.readFile(scriptPath, 'utf8');
    await fs.writeFile(scriptPath, insertMappings(script, rows), 'utf8');
    await fs.writeFile(path.join(worktree, 'docs', 'SCOUT-BADGE-AUTHOR-NORMAL-09-30-MANIFEST.csv'), buildManifest(rows, zipSha256), 'utf8');
    await fs.writeFile(path.join(worktree, 'tests', 'scout-author-normal-09-30-artwork.test.mjs'), buildTest(rows), 'utf8');
    await git(['add', 'assets/scout-badges', 'novelight-scout-record.js', 'docs/SCOUT-BADGE-AUTHOR-NORMAL-09-30-MANIFEST.csv', 'tests/scout-author-normal-09-30-artwork.test.mjs'], worktree);
    const staged = await git(['diff', '--cached', '--name-only'], worktree);
    const stagedFiles = staged.stdout.split(/\r?\n/).filter(Boolean);
    const expectedAssets = rows.map(row => `assets/scout-badges/${row.badgeId}.png`);
    const missingAssets = expectedAssets.filter(file => !stagedFiles.includes(file) && !fs.stat(path.join(worktree, file)).catch(() => null));
    if (missingAssets.length) throw new Error(`Missing staged assets: ${missingAssets.join(', ')}`);
    await git(['commit', '-m', 'Register Author Normal artwork #9-#30'], worktree);
    const commitSha = (await git(['rev-parse', 'HEAD'], worktree)).stdout;
    await git(['push', '-u', 'origin', branch], worktree);
    return {
      nloRoute: 'github_bridge',
      remoteDesktopCommanderDependency: false,
      branch,
      commitSha,
      sourceZip: path.basename(SOURCE_ZIP),
      sourceZipSha256: zipSha256,
      registeredCount: rows.length,
      badgeIds: rows.map(row => row.badgeId),
      assets: rows.map(row => ({ badgeId: row.badgeId, fileName: row.fileName, sha256: row.sha256, size: row.size, geometry: `${row.width}x${row.height}` }))
    };
  } finally {
    await git(['worktree', 'remove', '--force', worktree]).catch(() => {});
  }
}
async function postResult(request, status, details) {
  const body = [RESULT_PREFIX, '', `- request_id: \`${request.requestId}\``, '- action: `author_badge_register22`', `- status: **${status}**`, `- observed_at: \`${new Date().toISOString()}\``, '', '~~~json', typeof details === 'string' ? details : JSON.stringify(details, null, 2), '~~~'].join('\n');
  await githubApi('POST', `/repos/${OWNER}/${REPOSITORY}/issues/${ISSUE_NUMBER}/comments`, { body });
}
async function processPendingRequest() {
  if (!token()) return;
  const since = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const comments = await githubApi('GET', `/repos/${OWNER}/${REPOSITORY}/issues/${ISSUE_NUMBER}/comments?per_page=100&since=${encodeURIComponent(since)}`);
  const requests = [];
  for (const comment of comments || []) {
    try { const request = parseRequest(comment); if (request) requests.push({ request, commentId: Number(comment.id) }); }
    catch (error) { console.error('[NLO author-badge-register22] invalid request:', error instanceof Error ? error.message : String(error)); }
  }
  if (!requests.length) return;
  requests.sort((a, b) => a.commentId - b.commentId);
  const target = requests.at(-1).request;
  if ((comments || []).some(comment => String(comment.body || '').startsWith(RESULT_PREFIX) && String(comment.body || '').includes(`- request_id: \`${target.requestId}\``))) return;
  try { await postResult(target, 'success', await stage(target)); }
  catch (error) { await postResult(target, 'failure', error instanceof Error ? error.stack || error.message : String(error)); }
}
void processPendingRequest().catch(error => console.error('[NLO author-badge-register22] startup failed:', error));
