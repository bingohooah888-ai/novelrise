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
const REQUEST_PREFIX = 'NOVELIGHT_AUTHOR_BADGE_REGISTER13_REQUEST ';
const RESULT_PREFIX = 'NOVELIGHT_AUTHOR_BADGE_REGISTER13_RESULT_V1';
const CONFIRMATION = 'REGISTER_AUTHOR_EASY_NORMAL_01_08';
const REQUEST_ID_RE = /^cmdr-[0-9]{8}T[0-9]{6}Z-[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../..');
const POLL_MS = 10000;
let busy = false;

const PACKS = [
  {
    file: 'NOVELIGHT_Author_Easy_5_images.zip',
    sha256: '2c0287c1fa9aad0c7f7410dca4582df36a968ac0b3a64c1db5f59fda39d716a6',
    targets: [
      ['Author_Easy_001.png', 'author_novel_001', '407549e1c7261e773ed06377d099af8d377d08f1e028fc63731e4ba926a2e234', 1284, 1225],
      ['Author_Easy_002.png', 'author_episode_001', '2c2e3c6aab341bbc9e2d26c4566231d794e43f857a40decc07bbf2d5bd8f06f7', 1284, 1225],
      ['Author_Easy_003.png', 'author_reader_001', '49ea365e2325391e1f46fbc4d5ef1c5515c3629957f88040fdc0a11364661312', 1284, 1225],
      ['Author_Easy_004.png', 'author_favorite_001', '21d01cd1fef5ecc4421bf80966f3f2f8e0f1fd1a82f9aa781f563452674319a9', 1284, 1225],
      ['Author_Easy_005.png', 'author_comment_001', '72834126b93bed4b55f0ba826a92dd383c4e9214c4d0dfbeac035a8d56518fd7', 1254, 1254]
    ]
  },
  {
    file: 'NOVELIGHT_Author_Normal_30_images.zip',
    sha256: '3c8bb8937b71a936f60fbddefe2f87d4a593a0bb759e11fa3d953ea3525480d4',
    targets: [
      ['Author_Normal_001.png', 'author_episode_010', 'cad5b725fbc4d226ef2d843b3b2b1446cdb2607c9e953301b12e89e27c9d6db8', 1254, 1254],
      ['Author_Normal_002.png', 'author_episode_025', '8d613142ee4661300d8b6fecfe1796223ee631711f0d07e093f13e456c417e3b', 1291, 1218],
      ['Author_Normal_003.png', 'author_episode_050', '116d3752beaf0a72fc930902f58f87eb0c840bbbe4f0402e5c166078af09c346', 1254, 1254],
      ['Author_Normal_004.png', 'author_episode_100', '87410964d7ac57856c91aa7d220da32a42f0b6604397fa51458a65a624762bbe', 1254, 1254],
      ['Author_Normal_005.png', 'author_episode_250', '652ccbfd558e355a64f4f1907abdf5e6364bda131209ee95c097e624d3dc0701', 1254, 1254],
      ['Author_Normal_006.png', 'author_chars_010k', '7c283e6e3f00e6956f16e335477f1d0680788d5e5efd58e4985f8ac1f53c076d', 1254, 1254],
      ['Author_Normal_007.png', 'author_chars_050k', '705c8fa937bb1094c601a1ad807fd4d757bde84a4bf65c6414d720bff2bd0ec9', 1254, 1254],
      ['Author_Normal_008.png', 'author_chars_100k', '0f709511be4af5c568d84e6aad7b446682d1a7ebddbd09f1166fba48ee19b8c5', 1254, 1254]
    ]
  }
];

function token() {
  return String(process.env.NOVELIGHT_BRIDGE_GITHUB_TOKEN || '').trim();
}

async function githubApi(method, apiPath, body) {
  const response = await fetch('https://api.github.com' + apiPath, {
    method,
    headers: {
      Authorization: 'Bearer ' + token(),
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'NOVELIGHT-Commander-Author-Badge-Register13'
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
    request.action !== 'author_badge_register13' ||
    !REQUEST_ID_RE.test(String(request.requestId || '')) ||
    request?.args?.confirmation !== CONFIRMATION ||
    Object.keys(request.args || {}).sort().join(',') !== 'confirmation'
  ) {
    throw new Error('Author badge register13 request does not match the fixed contract.');
  }
  return request;
}

async function git(args, cwd = REPO_ROOT) {
  const { stdout = '', stderr = '' } = await execFileAsync('git', args, {
    cwd,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024
  });
  return { stdout: String(stdout).trim(), stderr: String(stderr).trim() };
}

function pngGeometry(bytes) {
  if (bytes.length < 24 || bytes.toString('hex', 0, 8) !== '89504e470d0a1a0a') throw new Error('Invalid PNG');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

async function loadTargets() {
  const rows = [];
  const zipHashes = {};
  for (const pack of PACKS) {
    const sourceZip = path.join(os.homedir(), 'Downloads', pack.file);
    const zipBytes = await fs.readFile(sourceZip);
    const zipSha256 = createHash('sha256').update(zipBytes).digest('hex');
    if (zipSha256 !== pack.sha256) throw new Error(`${pack.file} ZIP hash mismatch`);
    zipHashes[pack.file] = zipSha256;
    const zip = await JSZip.loadAsync(zipBytes);
    for (const [fileName, badgeId, expectedSha256, expectedWidth, expectedHeight] of pack.targets) {
      const entry = zip.file(fileName);
      if (!entry) throw new Error(`${pack.file} missing ${fileName}`);
      const bytes = await entry.async('nodebuffer');
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      if (sha256 !== expectedSha256) throw new Error(`${fileName} source hash mismatch`);
      const geometry = pngGeometry(bytes);
      if (geometry.width !== expectedWidth || geometry.height !== expectedHeight) {
        throw new Error(`${fileName} unexpected geometry ${geometry.width}x${geometry.height}`);
      }
      rows.push({
        sourceZip: pack.file,
        sourceZipSha256: zipSha256,
        fileName,
        badgeId,
        bytes,
        sha256,
        size: bytes.length,
        width: geometry.width,
        height: geometry.height
      });
    }
  }
  if (rows.length !== 13) throw new Error(`Expected 13 approved assets, got ${rows.length}`);
  return { rows, zipHashes };
}

function insertMappings(scriptText, rows) {
  const start = scriptText.indexOf('const badgeArtworkPaths = {');
  if (start < 0) throw new Error('badgeArtworkPaths object not found');
  const close = scriptText.indexOf('\n  };', start);
  if (close < 0) throw new Error('badgeArtworkPaths closing marker not found');
  const objectText = scriptText.slice(start, close);
  const additions = [];
  for (const row of rows) {
    const expected = `assets/scout-badges/${row.badgeId}.png`;
    const escaped = row.badgeId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = objectText.match(new RegExp(`(?:^|\\n)\\s*${escaped}:\\s*['\"]([^'\"]+)['\"]`));
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

function buildManifest(rows) {
  const lines = ['order,source_file,badge_id,asset_path,sha256,size_bytes,width,height,source_zip,source_zip_sha256'];
  rows.forEach((row, index) => lines.push([
    index + 1,
    row.fileName,
    row.badgeId,
    `assets/scout-badges/${row.badgeId}.png`,
    row.sha256,
    row.size,
    row.width,
    row.height,
    row.sourceZip,
    row.sourceZipSha256
  ].map(csvEscape).join(',')));
  return lines.join('\n') + '\n';
}

function buildTest(rows) {
  const expected = rows.map(row => `  ['${row.badgeId}', '${row.sha256}', ${row.width}, ${row.height}]`).join(',\n');
  return [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import fs from 'node:fs';",
    "import crypto from 'node:crypto';",
    '',
    '// prettier-ignore',
    'const expected = [',
    expected,
    '];',
    '',
    "test('Author Easy + Normal #1-#8 artwork keeps approved bytes and UI mappings', () => {",
    "  const script = fs.readFileSync('novelight-scout-record.js', 'utf8');",
    '  assert.equal(expected.length, 13);',
    '  for (const [badgeId, expectedSha, width, height] of expected) {',
    "    const file = 'assets/scout-badges/' + badgeId + '.png';",
    '    const bytes = fs.readFileSync(file);',
    "    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', badgeId);",
    '    assert.equal(bytes.readUInt32BE(16), width, badgeId);',
    '    assert.equal(bytes.readUInt32BE(20), height, badgeId);',
    "    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), expectedSha, badgeId);",
    "    assert.ok(script.includes(badgeId + \": 'assets/scout-badges/\" + badgeId + \".png'\"), badgeId);",
    '  }',
    '});',
    ''
  ].join('\n');
}

async function stage(request) {
  const { rows, zipHashes } = await loadTargets();
  await git(['fetch', 'origin', 'main']);
  const branch = `feat/scout-author-easy-normal-01-08-${request.requestId.slice(5, 20).replace('T', '-')}`;
  const remote = await git(['ls-remote', '--heads', 'origin', branch]);
  if (remote.stdout) throw new Error(`Remote branch already exists: ${branch}`);
  const worktree = path.join(os.tmpdir(), `novelight-author-badge13-${request.requestId}`);
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
    const manifestPath = path.join(worktree, 'docs', 'SCOUT-BADGE-AUTHOR-EASY-NORMAL-01-08-MANIFEST.csv');
    const testPath = path.join(worktree, 'tests', 'scout-author-easy-normal-01-08-artwork.test.mjs');
    await fs.writeFile(manifestPath, buildManifest(rows), 'utf8');
    await fs.writeFile(testPath, buildTest(rows), 'utf8');
    await git(['add', ...rows.map(row => `assets/scout-badges/${row.badgeId}.png`), 'novelight-scout-record.js', 'docs/SCOUT-BADGE-AUTHOR-EASY-NORMAL-01-08-MANIFEST.csv', 'tests/scout-author-easy-normal-01-08-artwork.test.mjs'], worktree);
    const staged = (await git(['diff', '--cached', '--name-only'], worktree)).stdout.split(/\r?\n/).filter(Boolean).sort();
    const expectedStaged = [
      ...rows.map(row => `assets/scout-badges/${row.badgeId}.png`),
      'novelight-scout-record.js',
      'docs/SCOUT-BADGE-AUTHOR-EASY-NORMAL-01-08-MANIFEST.csv',
      'tests/scout-author-easy-normal-01-08-artwork.test.mjs'
    ].sort();
    if (JSON.stringify(staged) !== JSON.stringify(expectedStaged)) {
      throw new Error(`Unexpected staged scope: ${staged.join(', ')}`);
    }
    await git(['commit', '-m', 'Register Author Easy and Normal artwork #1-#8'], worktree);
    const commitSha = (await git(['rev-parse', 'HEAD'], worktree)).stdout;
    await git(['push', '-u', 'origin', branch], worktree);
    return {
      nloRoute: 'github_bridge',
      remoteDesktopCommanderDependency: false,
      branch,
      commitSha,
      expectedCount: 13,
      registeredCount: rows.length,
      imageProcessing: 'none',
      zipHashes,
      badgeIds: rows.map(row => row.badgeId),
      assets: rows.map(row => ({
        badgeId: row.badgeId,
        fileName: row.fileName,
        sha256: row.sha256,
        size: row.size,
        geometry: `${row.width}x${row.height}`,
        sourceZip: row.sourceZip
      }))
    };
  } finally {
    await git(['worktree', 'remove', '--force', worktree]).catch(() => {});
  }
}

async function postResult(request, status, details) {
  const body = [
    RESULT_PREFIX,
    '',
    `- request_id: \`${request.requestId}\``,
    '- action: `author_badge_register13`',
    `- status: **${status}**`,
    `- observed_at: \`${new Date().toISOString()}\``,
    '',
    '~~~json',
    typeof details === 'string' ? details : JSON.stringify(details, null, 2),
    '~~~'
  ].join('\n');
  await githubApi('POST', `/repos/${OWNER}/${REPOSITORY}/issues/${ISSUE_NUMBER}/comments`, { body });
}

async function processPendingRequest() {
  if (busy || !token()) return;
  busy = true;
  try {
    const since = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const comments = await githubApi('GET', `/repos/${OWNER}/${REPOSITORY}/issues/${ISSUE_NUMBER}/comments?per_page=100&since=${encodeURIComponent(since)}`);
    const requests = [];
    for (const comment of comments || []) {
      try {
        const request = parseRequest(comment);
        if (request) requests.push({ request, commentId: Number(comment.id) });
      } catch (error) {
        console.error('[NLO author-badge-register13] invalid request:', error instanceof Error ? error.message : String(error));
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
      await postResult(target, 'success', await stage(target));
    } catch (error) {
      await postResult(target, 'failure', error instanceof Error ? error.stack || error.message : String(error));
    }
  } finally {
    busy = false;
  }
}

void processPendingRequest().catch(error => console.error('[NLO author-badge-register13] startup failed:', error));
const timer = setInterval(() => {
  void processPendingRequest().catch(error => console.error('[NLO author-badge-register13] poll failed:', error));
}, POLL_MS);
timer.unref?.();
