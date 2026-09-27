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
const REQUEST_PREFIX = 'NOVELIGHT_HARD_BADGE_REGISTER25_REQUEST ';
const RESULT_PREFIX = 'NOVELIGHT_HARD_BADGE_REGISTER25_RESULT_V1';
const CONFIRMATION = 'REGISTER_HARD_BADGES_25';
const REQUEST_ID_RE = /^cmdr-[0-9]{8}T[0-9]{6}Z-[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../..');
const SOURCE_ZIP = 'NOVELIGHT_HARD_BADGES_25_FINAL.zip';
const SOURCE_ZIP_SHA256 = 'bd82a269fa8f793a1d7489dbf04f11eed9e7669bc203bf9592d3f72245b1a520';

const TARGETS = [
  ['reader_hard/reader_read_500.png', 'reader', 81, 'reader_read_500', '381701ea4948cd89559acf901bf53dd8e5a3cfab92c2fd7931070698e902418f', 1254, 1254],
  ['reader_hard/reader_read_1000.png', 'reader', 82, 'reader_read_1000', '6acc76b9219ab24acdd7fc01e50519fb2136ace8d6b199513036bd4da5873fb3', 1254, 1254],
  ['reader_hard/reader_new_author_250.png', 'reader', 83, 'reader_new_author_250', '1d93673a1a5e432a16771c335e0f269338380b5132166245b66adcdcf22631f3', 1254, 1254],
  ['reader_hard/reader_low_rank_250.png', 'reader', 84, 'reader_low_rank_250', '5c2df9692ee8eb2bb5e364615e16de44dd3689a3ef0420b23c705dc3d48d4098', 1254, 1254],
  ['reader_hard/reader_low_rank_500.png', 'reader', 85, 'reader_low_rank_500', '160177012df2bbf4760870d0388c48171d55b84e8fe102588ebab5ececd1d687', 1254, 1254],
  ['reader_hard/reader_discovery_plus2_050.png', 'reader', 86, 'reader_discovery_plus2_050', 'e33389260e4eeb1d467d4975ff95c267bfbdbac7c88d95b4de352590c279c44f', 1254, 1254],
  ['reader_hard/reader_discovery_plus2_100.png', 'reader', 87, 'reader_discovery_plus2_100', '959bafdbc74a0a01378afa73078e3e1dfd1edd19371ef9fa1beee8c4d64ca1eb', 1254, 1254],
  ['reader_hard/reader_discovery_plus3_025.png', 'reader', 88, 'reader_discovery_plus3_025', '807f14c83dae64e14ea4d76662fde52c752c1e49daf6e883e09d6c6a1a887923', 1254, 1254],
  ['reader_hard/reader_discovery_plus3_050.png', 'reader', 89, 'reader_discovery_plus3_050', '230a7c41ebde838d961e12e88b784b8cc882f5137bdcc3b0f095c22596944b4b', 1254, 1254],
  ['reader_hard/reader_discovery_plus4_010.png', 'reader', 90, 'reader_discovery_plus4_010', '9aa290034f326f244bca75bdd8d2789ac11e5627028af19213818d405e151973', 1536, 1536],
  ['reader_hard/reader_discovery_plus4_020.png', 'reader', 91, 'reader_discovery_plus4_020', 'f2d1bfacfbc3451688b4dff788bc2e7f1b96a94a25b4051323cb4b994f10e2e6', 1254, 1254],
  ['reader_hard/reader_discovery_plus5_001.png', 'reader', 92, 'reader_discovery_plus5_001', '7a481eaddd417c87ddfc16fa42facdcd43f2a948ce1d86c2fc3cb831fac2a56a', 1254, 1254],
  ['reader_hard/reader_discovery_plus5_003.png', 'reader', 93, 'reader_discovery_plus5_003', '2fb371c1ac995adc2a8b51c84a890bd08bade64efa845fad7233bbedd60ab579', 1254, 1254],
  ['reader_hard/reader_discovery_plus5_010.png', 'reader', 94, 'reader_discovery_plus5_010', '35a99e1c52f9d60079fdac04451a61026bf209c266e4294a910a6512fe19ce6e', 1254, 1254],
  ['reader_hard/reader_nova_010.png', 'reader', 95, 'reader_nova_010', '697c2ef7ae9b05ccccd1842fc8ba5346664b2f3577bb599b7332ab7094523a6e', 1254, 1254],
  ['reader_hard/reader_nova_025.png', 'reader', 96, 'reader_nova_025', '30127a10f22d7a9dd1d4eda9357a00d36780793ef267f51557227a31396efe6f', 1254, 1254],
  ['reader_hard/reader_gold_plus5_001.png', 'reader', 97, 'reader_gold_plus5_001', '1027b1e5d947b3e7cce3fc008e0b2830f015692d408cbcbcad2dccfcabbb001b', 1254, 1254],
  ['reader_hard/reader_silver_plus5_001.png', 'reader', 98, 'reader_silver_plus5_001', '1db512bb71104f32c741ad9ba82301ef736cceb2ce42817401dbbf5363cf58e9', 1254, 1254],
  ['reader_hard/reader_bronze_plus5_001.png', 'reader', 99, 'reader_bronze_plus5_001', '5de9db741a052ce05cba59acd6366ec87f067bbc671395b3692504671c997f99', 1254, 1254],
  ['reader_hard/reader_master_scout.png', 'reader', 100, 'reader_master_scout', 'ddc6b40f6805f8fc2e379d31f4e3f9ffc284b03ff53b680fa81068ca43772e45', 1254, 1254],
  ['author_hard/author_chars_1m.png', 'author', 36, 'author_chars_1m', 'cff952b10f38136b06ca05648488a454df2c727e1881da5402232789b94ab648', 1254, 1254],
  ['author_hard/author_completed_010.png', 'author', 37, 'author_completed_010', '64c755efff982576678c54b3c4371933fb2a0f911a7fac90eaa190c7911e4ab4', 1254, 1254],
  ['author_hard/author_unique_reader_1000.png', 'author', 38, 'author_unique_reader_1000', '00f88755ea4c5608dfa00af6375bf1cc96ce030873ab3063716bc66710e5b959', 1254, 1254],
  ['author_hard/author_favorite_500.png', 'author', 39, 'author_favorite_500', '311bce7c9052e11ad835e9e8e484bad03f5d5fe9dd0834f0953343896c177c1a', 1254, 1254],
  ['author_hard/author_discovered_plus2_005.png', 'author', 40, 'author_discovered_plus2_005', 'ba9ddd9a0edfca22a91d5de8e58c6b0ed2f76fba5bb1161688d66c7c51ced7b0', 1254, 1254]
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
      'User-Agent': 'NOVELIGHT-Commander-Hard-Badge-Register25'
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
    request.action !== 'hard_badge_register25' ||
    !REQUEST_ID_RE.test(String(request.requestId || '')) ||
    request?.args?.confirmation !== CONFIRMATION ||
    Object.keys(request.args || {}).sort().join(',') !== 'confirmation'
  ) {
    throw new Error('Hard badge register25 request does not match the fixed contract.');
  }
  return request;
}

async function git(args, cwd = REPO_ROOT) {
  const { stdout = '', stderr = '' } = await execFileAsync('git', args, {
    cwd,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024
  });
  return { stdout: String(stdout).trim(), stderr: String(stderr).trim() };
}

function pngGeometry(bytes) {
  if (bytes.length < 24 || bytes.toString('hex', 0, 8) !== '89504e470d0a1a0a') throw new Error('Invalid PNG');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

async function loadTargets() {
  const sourceZip = path.join(os.homedir(), 'Downloads', SOURCE_ZIP);
  const zipBytes = await fs.readFile(sourceZip);
  const zipSha256 = createHash('sha256').update(zipBytes).digest('hex');
  if (zipSha256 !== SOURCE_ZIP_SHA256) throw new Error('Hard badge ZIP hash mismatch.');
  const zip = await JSZip.loadAsync(zipBytes);
  const rows = [];
  for (const [sourceName, category, number, badgeId, expectedSha256, expectedWidth, expectedHeight] of TARGETS) {
    const entry = zip.file(sourceName);
    if (!entry) throw new Error(`Hard badge ZIP missing ${sourceName}`);
    const bytes = await entry.async('nodebuffer');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (sha256 !== expectedSha256) throw new Error(`${sourceName} source hash mismatch`);
    const geometry = pngGeometry(bytes);
    if (geometry.width !== expectedWidth || geometry.height !== expectedHeight) {
      throw new Error(`${sourceName} unexpected geometry ${geometry.width}x${geometry.height}`);
    }
    rows.push({ sourceName, category, number, badgeId, bytes, sha256, width: geometry.width, height: geometry.height });
  }
  if (rows.length !== 25) throw new Error(`Expected 25 Hard assets, got ${rows.length}`);
  return rows;
}

function assetName(badgeId) {
  return `hard_${badgeId}.png`;
}

function insertMappings(scriptText, rows) {
  const marker = '  Object.assign(badgeArtworkPaths, readerNormalArtworkPaths);';
  if (!scriptText.includes(marker)) throw new Error('Reader Normal artwork assignment marker not found.');
  if (scriptText.includes('const hardArtworkPaths = {')) throw new Error('Hard artwork mapping already exists.');
  const lines = rows.map(row => `    ${row.badgeId}: 'assets/scout-badges/${assetName(row.badgeId)}'`);
  const block = [
    '',
    '  const hardArtworkPaths = {',
    lines.join(',\n'),
    '  };',
    '  Object.assign(badgeArtworkPaths, hardArtworkPaths);'
  ].join('\n');
  return scriptText.replace(marker, marker + block);
}

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function buildManifest(rows) {
  const lines = ['category,number,badge_id,source_file,asset_path,sha256,width,height,source_zip,source_zip_sha256'];
  for (const row of rows) {
    lines.push([
      row.category,
      row.number,
      row.badgeId,
      row.sourceName,
      `assets/scout-badges/${assetName(row.badgeId)}`,
      row.sha256,
      row.width,
      row.height,
      SOURCE_ZIP,
      SOURCE_ZIP_SHA256
    ].map(csvEscape).join(','));
  }
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
    "test('Reader Hard 20 + Author Hard 5 artwork keeps approved source bytes and explicit mappings', () => {",
    "  const script = fs.readFileSync('novelight-scout-record.js', 'utf8');",
    '  assert.equal(expected.length, 25);',
    '  for (const [badgeId, expectedSha, width, height] of expected) {',
    "    const file = 'assets/scout-badges/hard_' + badgeId + '.png';",
    '    const bytes = fs.readFileSync(file);',
    "    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', badgeId);",
    '    assert.equal(bytes.readUInt32BE(16), width, badgeId);',
    '    assert.equal(bytes.readUInt32BE(20), height, badgeId);',
    "    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), expectedSha, badgeId);",
    "    assert.ok(script.includes(badgeId + \": 'assets/scout-badges/hard_\" + badgeId + \".png'\"), badgeId);",
    '  }',
    '});',
    ''
  ].join('\n');
}

async function stage(request) {
  const rows = await loadTargets();
  await git(['fetch', 'origin', 'main']);
  const branch = `feat/scout-hard-badges-25-${request.requestId.slice(5, 20).replace('T', '-')}`;
  const remote = await git(['ls-remote', '--heads', 'origin', branch]);
  if (remote.stdout) throw new Error(`Remote branch already exists: ${branch}`);
  const worktree = path.join(os.tmpdir(), `novelight-hard-badge25-${request.requestId}`);
  await fs.rm(worktree, { recursive: true, force: true });
  await git(['worktree', 'add', '-b', branch, worktree, 'origin/main']);
  try {
    const assetDir = path.join(worktree, 'assets', 'scout-badges');
    await fs.mkdir(assetDir, { recursive: true });
    for (const row of rows) {
      await fs.writeFile(path.join(assetDir, assetName(row.badgeId)), row.bytes);
    }
    const scriptPath = path.join(worktree, 'novelight-scout-record.js');
    const script = await fs.readFile(scriptPath, 'utf8');
    await fs.writeFile(scriptPath, insertMappings(script, rows), 'utf8');
    const manifestPath = path.join(worktree, 'docs', 'SCOUT-BADGE-HARD-25-MANIFEST.csv');
    const testPath = path.join(worktree, 'tests', 'scout-hard-25-artwork.test.mjs');
    await fs.writeFile(manifestPath, buildManifest(rows), 'utf8');
    await fs.writeFile(testPath, buildTest(rows), 'utf8');

    const assetPaths = rows.map(row => `assets/scout-badges/${assetName(row.badgeId)}`);
    await git(['add', ...assetPaths, 'novelight-scout-record.js', 'docs/SCOUT-BADGE-HARD-25-MANIFEST.csv', 'tests/scout-hard-25-artwork.test.mjs'], worktree);
    const expectedStaged = [...assetPaths, 'novelight-scout-record.js', 'docs/SCOUT-BADGE-HARD-25-MANIFEST.csv', 'tests/scout-hard-25-artwork.test.mjs'].sort();
    const staged = (await git(['diff', '--cached', '--name-only'], worktree)).stdout.split(/\r?\n/).filter(Boolean).sort();
    if (JSON.stringify(staged) !== JSON.stringify(expectedStaged)) {
      throw new Error(`Unexpected staged paths: ${JSON.stringify(staged)}`);
    }

    await execFileAsync(process.execPath, ['--test', 'tests/scout-hard-25-artwork.test.mjs'], {
      cwd: worktree,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024
    });
    await git(['commit', '-m', 'Register approved Hard badge artwork batch'], worktree);
    const commit = (await git(['rev-parse', 'HEAD'], worktree)).stdout;
    await git(['push', '-u', 'origin', branch], worktree);
    return {
      nloRoute: 'github_bridge',
      remoteDesktopCommanderDependency: false,
      sourceZip: SOURCE_ZIP,
      sourceZipSha256: SOURCE_ZIP_SHA256,
      count: rows.length,
      readerHardCount: rows.filter(row => row.category === 'reader').length,
      authorHardCount: rows.filter(row => row.category === 'author').length,
      branch,
      commit,
      assets: rows.map(row => ({ badgeId: row.badgeId, asset: assetName(row.badgeId), sha256: row.sha256, width: row.width, height: row.height }))
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
    '- action: `hard_badge_register25`',
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
  if (!token()) return;
  const since = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const comments = await githubApi('GET', `/repos/${OWNER}/${REPOSITORY}/issues/${ISSUE_NUMBER}/comments?per_page=100&since=${encodeURIComponent(since)}`);
  const requests = [];
  for (const comment of comments || []) {
    try {
      const request = parseRequest(comment);
      if (request) requests.push({ request, commentId: Number(comment.id) });
    } catch (error) {
      console.error('[NLO hard-badge-register25] invalid request:', error instanceof Error ? error.message : String(error));
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
}

void processPendingRequest().catch(error => {
  console.error('[NLO hard-badge-register25] startup failed:', error);
});
