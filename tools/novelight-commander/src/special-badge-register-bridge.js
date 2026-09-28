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
const REQUEST_PREFIX = 'NOVELIGHT_SCOUT_SPECIAL_REGISTER_REQUEST ';
const RESULT_PREFIX = 'NOVELIGHT_SCOUT_SPECIAL_REGISTER_RESULT_V1';
const CONFIRMATION = 'REGISTER_SCOUT_RANK_SEED_BETA_ARTWORK';
const REQUEST_ID_RE = /^cmdr-[0-9]{8}T[0-9]{6}Z-[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../..');

const RANK_ZIP = 'NOVELIGHT_SCOUT_RANK_BADGES_10_FINAL.zip';
const RANK_ZIP_SHA256 = '347a33e4f35aa4efc1cec3203ef8aef918326acbd22b7d7e5fe0449e96faee00';
const SPECIAL_ZIP = 'NOVELIGHT_SCOUT_SPECIAL_ARTWORK_FINAL.zip';
const SPECIAL_ZIP_SHA256 = 'b432feefcdfe805f09f24fe1ed6470358d43706c24c4d3d4abea27624294b3a8';

const RANK_TARGETS = [
  ['NOVELIGHT_SCOUT_RANK_BADGES_10_FINAL/scout_rank_01_noctis.png', 1, 'NOCTIS', 'scout_rank_01_noctis.png', 'c742722fd37a7c74171a383a394339f24e9dbb920b43c31f3e32fb30ee6e523f'],
  ['NOVELIGHT_SCOUT_RANK_BADGES_10_FINAL/scout_rank_02_vesper.png', 2, 'VESPER', 'scout_rank_02_vesper.png', '126657b5d423e1b623dc53cdabef7d9f211cbf40a4fd3559135b53e7e3e61d05'],
  ['NOVELIGHT_SCOUT_RANK_BADGES_10_FINAL/scout_rank_03_umbra.png', 3, 'UMBRA', 'scout_rank_03_umbra.png', '7d4c810c921953018bf6b8b99f3d80972a62fa80cbc4e976d251b0784972d5df'],
  ['NOVELIGHT_SCOUT_RANK_BADGES_10_FINAL/scout_rank_04_astra.png', 4, 'ASTRA', 'scout_rank_04_astra.png', 'cd599bfe384fdb7ee2568baae0d3fbc663bf6b2575509b6ca29d365d05e03a4a'],
  ['NOVELIGHT_SCOUT_RANK_BADGES_10_FINAL/scout_rank_05_lucent.png', 5, 'LUCENT', 'scout_rank_05_lucent.png', 'a613bfd554e590de6d6f1741ebe6f5fc9ee5695927d82556a121a535ad6537bb'],
  ['NOVELIGHT_SCOUT_RANK_BADGES_10_FINAL/scout_rank_06_aurelis.png', 6, 'AURELIS', 'scout_rank_06_aurelis.png', 'be965057b755755ff320583f270c1c51b62176daeb77f0079f669355b39a8c33'],
  ['NOVELIGHT_SCOUT_RANK_BADGES_10_FINAL/scout_rank_07_celestia.png', 7, 'CELESTIA', 'scout_rank_07_celestia.png', 'c7d8cbb902788897330cc69a8b3750bb0656ca83eb1656adc930ad7688616532'],
  ['NOVELIGHT_SCOUT_RANK_BADGES_10_FINAL/scout_rank_08_empyrean.png', 8, 'EMPYREAN', 'scout_rank_08_empyrean.png', '465978b21c2080987a7db68e888784154283a211d98c54903e379a019af9af77'],
  ['NOVELIGHT_SCOUT_RANK_BADGES_10_FINAL/scout_rank_09_seraph.png', 9, 'SERAPH', 'scout_rank_09_seraph.png', 'b26d3b39b49f11568e70cc0edf94ed2de7adbf8d4f04307b22401643be3798a8'],
  ['NOVELIGHT_SCOUT_RANK_BADGES_10_FINAL/scout_rank_10_luminaris.png', 10, 'LUMINARIS', 'scout_rank_10_luminaris.png', 'd5614c010a576576e2743578c0aeb20b7f09007ecef752d9380c2aaccdc26cae']
];

const SPECIAL_TARGETS = [
  ['BRONZE_LIGHT_SEED_MASTER_1536.png', 'light_seed_bronze.png', '93f84010d47a0848be102f738383a89e4815238fde703f9f8c1666bfcf7e3a90', 1536, 1536, 'BRONZE'],
  ['SILVER_LIGHT_SEED_MASTER_1536_FINAL.png', 'light_seed_silver.png', '6aaf6a7a264545ed8592719228ee80d00e372d6851e3954395c31d1ea6aa981e', 1536, 1536, 'SILVER'],
  ['NOVELIGHT_LIGHT_SEED_GOLD_1536.png', 'light_seed_gold.png', '61a2f6b1a1fa2990267f2435f2a3e1e4328c90472c9a1f7e4c029986ad168e68', 1536, 1536, 'GOLD'],
  ['NOVELIGHT_BETA_BADGE_MASTER_1536.png', 'limited_beta_participant.png', 'f503aeaf0f5d22f8ec0a4dbe3ccab257c4744e02be02061160755e3050ff4a3c', 1536, 1536, 'BETA']
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
      'User-Agent': 'NOVELIGHT-Commander-Scout-Special-Register'
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
    request.action !== 'scout_special_register' ||
    !REQUEST_ID_RE.test(String(request.requestId || '')) ||
    request?.args?.confirmation !== CONFIRMATION ||
    Object.keys(request.args || {}).sort().join(',') !== 'confirmation'
  ) {
    throw new Error('Scout special register request does not match the fixed contract.');
  }
  return request;
}

async function git(args, cwd = REPO_ROOT) {
  const { stdout = '', stderr = '' } = await execFileAsync('git', args, {
    cwd,
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024
  });
  return { stdout: String(stdout).trim(), stderr: String(stderr).trim() };
}

function pngGeometry(bytes) {
  if (bytes.length < 24 || bytes.toString('hex', 0, 8) !== '89504e470d0a1a0a') throw new Error('Invalid PNG');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function loadRankRows() {
  const source = path.join(os.homedir(), 'Downloads', RANK_ZIP);
  const zipBytes = await fs.readFile(source).catch(error => {
    if (error?.code === 'ENOENT') throw new Error(`${RANK_ZIP} was not found in Downloads.`);
    throw error;
  });
  if (sha256(zipBytes) !== RANK_ZIP_SHA256) throw new Error('SCOUT Rank ZIP hash mismatch.');
  const zip = await JSZip.loadAsync(zipBytes);
  const rows = [];
  for (const [entryName, tier, rankName, targetName, expectedSha] of RANK_TARGETS) {
    const entry = zip.file(entryName);
    if (!entry) throw new Error(`SCOUT Rank ZIP missing ${entryName}`);
    const bytes = await entry.async('nodebuffer');
    const actualSha = sha256(bytes);
    if (actualSha !== expectedSha) throw new Error(`${entryName} source hash mismatch.`);
    const geometry = pngGeometry(bytes);
    if (geometry.width !== 1254 || geometry.height !== 1254) throw new Error(`${entryName} unexpected geometry.`);
    rows.push({ tier, rankName, targetName, bytes, sha256: actualSha, width: geometry.width, height: geometry.height, sourceName: entryName });
  }
  return rows;
}

async function loadSpecialRows() {
  const source = path.join(os.homedir(), 'Downloads', SPECIAL_ZIP);
  const zipBytes = await fs.readFile(source).catch(error => {
    if (error?.code === 'ENOENT') throw new Error(`${SPECIAL_ZIP} was not found in Downloads.`);
    throw error;
  });
  if (sha256(zipBytes) !== SPECIAL_ZIP_SHA256) throw new Error('SCOUT special artwork ZIP hash mismatch.');
  const zip = await JSZip.loadAsync(zipBytes);
  const rows = [];
  for (const [sourceName, targetName, expectedSha, expectedWidth, expectedHeight, role] of SPECIAL_TARGETS) {
    const entry = zip.file(sourceName);
    if (!entry) throw new Error(`SCOUT special artwork ZIP missing ${sourceName}`);
    const bytes = await entry.async('nodebuffer');
    const actualSha = sha256(bytes);
    if (actualSha !== expectedSha) throw new Error(`${sourceName} source hash mismatch.`);
    const geometry = pngGeometry(bytes);
    if (geometry.width !== expectedWidth || geometry.height !== expectedHeight) throw new Error(`${sourceName} unexpected geometry ${geometry.width}x${geometry.height}.`);
    rows.push({ role, sourceName, targetName, bytes, sha256: actualSha, width: geometry.width, height: geometry.height });
  }
  return rows;
}

function replaceOnce(text, needle, replacement, label) {
  const first = text.indexOf(needle);
  if (first < 0) throw new Error(`${label} marker not found.`);
  if (text.indexOf(needle, first + needle.length) >= 0) throw new Error(`${label} marker is not unique.`);
  return text.slice(0, first) + replacement + text.slice(first + needle.length);
}

function patchScript(script, rankRows) {
  if (script.includes('const rankArtworkPaths = [')) throw new Error('SCOUT Rank artwork mapping already exists.');
  if (script.includes("limited_beta_participant: 'assets/scout-badges/limited_beta_participant.png'")) throw new Error('β participant artwork mapping already exists.');

  const rankBandsNeedle = "  const rankBands = rankNames.slice(1).map((name, index) => ({\n";
  const rankPaths = ["    ''", ...rankRows.map(row => `    'assets/scout-record/ranks/${row.targetName}'`)].join(',\n');
  const rankBlock = ['  const rankArtworkPaths = [', rankPaths, '  ];', ''].join('\n');
  script = replaceOnce(script, rankBandsNeedle, rankBlock + rankBandsNeedle, 'rank artwork array');

  const betaNeedle = "    limited_founding_author: 'assets/founding-authors-badge-2026.png',\n";
  script = replaceOnce(script, betaNeedle, betaNeedle + "    limited_beta_participant: 'assets/scout-badges/limited_beta_participant.png',\n", 'β badge mapping');

  const orbNeedle = ["      const orb = document.createElement('div');", "      orb.className = 'rank-orb';", "      orb.textContent = band.name.slice(0, 1);"].join('\n');
  const orbReplacement = ["      const orb = document.createElement('div');", "      orb.className = 'rank-orb rank-orb-artwork';", "      const rankImage = document.createElement('img');", "      rankImage.src = rankArtworkPaths[band.tier];", "      rankImage.alt = '';", "      rankImage.loading = 'lazy';", "      rankImage.decoding = 'async';", "      orb.append(rankImage);"].join('\n');
  script = replaceOnce(script, orbNeedle, orbReplacement, 'Rank Path artwork');

  const emblemNeedle = "    setText('rankEmblem', rankNames[tier].slice(0, 1));";
  const emblemReplacement = ["    const rankEmblem = document.getElementById('rankEmblem');", "    if (rankEmblem) {", "      rankEmblem.classList.add('scout-emblem-artwork');", "      const rankImage = document.createElement('img');", "      rankImage.src = rankArtworkPaths[tier];", "      rankImage.alt = '';", "      rankImage.decoding = 'async';", "      rankEmblem.replaceChildren(rankImage);", "    }"].join('\n');
  script = replaceOnce(script, emblemNeedle, emblemReplacement, 'current Rank artwork');
  return script;
}

function patchHtml(html) {
  const replacements = [
    ['<div class="seed-inventory-icon-slot" data-light-seed-icon-slot="GOLD" aria-hidden="true"><span>◇</span></div>', '<div class="seed-inventory-icon-slot" data-light-seed-icon-slot="GOLD" aria-hidden="true"><img src="assets/scout-record/light-seed/light_seed_gold.png" alt=""></div>'],
    ['<div class="seed-inventory-icon-slot" data-light-seed-icon-slot="SILVER" aria-hidden="true"><span>◇</span></div>', '<div class="seed-inventory-icon-slot" data-light-seed-icon-slot="SILVER" aria-hidden="true"><img src="assets/scout-record/light-seed/light_seed_silver.png" alt=""></div>'],
    ['<div class="seed-inventory-icon-slot" data-light-seed-icon-slot="BRONZE" aria-hidden="true"><span>◇</span></div>', '<div class="seed-inventory-icon-slot" data-light-seed-icon-slot="BRONZE" aria-hidden="true"><img src="assets/scout-record/light-seed/light_seed_bronze.png" alt=""></div>']
  ];
  for (const [from, to] of replacements) html = replaceOnce(html, from, to, `LIGHT SEED artwork`);
  return html;
}

function patchCss(css) {
  if (css.includes('/* Approved SCOUT Rank artwork */')) throw new Error('SCOUT special artwork CSS already exists.');
  return css.trimEnd() + '\n\n' + [
    '/* Approved SCOUT Rank artwork */',
    '.scout-emblem.scout-emblem-artwork{border:0;border-radius:0;background:transparent;box-shadow:none}',
    '.scout-emblem.scout-emblem-artwork::before,.scout-emblem.scout-emblem-artwork::after{display:none}',
    '.scout-emblem.scout-emblem-artwork img{display:block;width:100%;height:100%;object-fit:contain;filter:drop-shadow(0 10px 20px rgba(0,0,0,.34))}',
    '.rank-orb.rank-orb-artwork{overflow:visible;background:transparent}',
    '.rank-orb.rank-orb-artwork img{display:block;width:44px;height:44px;object-fit:contain;filter:drop-shadow(0 5px 9px rgba(0,0,0,.28))}',
    '.rank-node.current .rank-orb.rank-orb-artwork img{width:48px;height:48px}',
    ''
  ].join('\n');
}

function buildManifest(rankRows, specialRows) {
  return JSON.stringify({
    set: 'NOVELIGHT SCOUT Rank / LIGHT SEED / β Participant artwork',
    provenance: { rankSource: RANK_ZIP, rankSourceSha256: RANK_ZIP_SHA256, specialSource: SPECIAL_ZIP, specialSourceSha256: SPECIAL_ZIP_SHA256, policy: 'approved originals copied byte-for-byte; no resize or recompression' },
    ranks: rankRows.map(row => ({ tier: row.tier, name: row.rankName, source: row.sourceName, asset: `assets/scout-record/ranks/${row.targetName}`, sha256: row.sha256, width: row.width, height: row.height })),
    special: specialRows.map(row => ({ role: row.role, source: row.sourceName, asset: row.role === 'BETA' ? `assets/scout-badges/${row.targetName}` : `assets/scout-record/light-seed/${row.targetName}`, sha256: row.sha256, width: row.width, height: row.height }))
  }, null, 2) + '\n';
}

function buildTest(rankRows, specialRows) {
  const rows = [...rankRows.map(row => [`assets/scout-record/ranks/${row.targetName}`, row.sha256, row.width, row.height]), ...specialRows.map(row => [row.role === 'BETA' ? `assets/scout-badges/${row.targetName}` : `assets/scout-record/light-seed/${row.targetName}`, row.sha256, row.width, row.height])];
  return [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import fs from 'node:fs';",
    "import crypto from 'node:crypto';",
    '',
    `const expected = ${JSON.stringify(rows, null, 2)};`,
    '',
    "test('SCOUT Rank, LIGHT SEED and beta artwork preserve approved source bytes', () => {",
    "  const script = fs.readFileSync('novelight-scout-record.js', 'utf8');",
    "  const html = fs.readFileSync('scout-record.html', 'utf8');",
    '  assert.equal(expected.length, 14);',
    '  for (const [file, expectedSha, width, height] of expected) {',
    '    const bytes = fs.readFileSync(file);',
    "    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', file);",
    '    assert.equal(bytes.readUInt32BE(16), width, file);',
    '    assert.equal(bytes.readUInt32BE(20), height, file);',
    "    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), expectedSha, file);",
    '  }',
    "  assert.ok(script.includes(\"limited_beta_participant: 'assets/scout-badges/limited_beta_participant.png'\"));",
    "  assert.ok(script.includes('const rankArtworkPaths = ['));",
    "  assert.ok(script.includes(\"rankImage.src = rankArtworkPaths[band.tier]\"));",
    "  assert.ok(script.includes(\"rankImage.src = rankArtworkPaths[tier]\"));",
    "  assert.ok(html.includes('assets/scout-record/light-seed/light_seed_gold.png'));",
    "  assert.ok(html.includes('assets/scout-record/light-seed/light_seed_silver.png'));",
    "  assert.ok(html.includes('assets/scout-record/light-seed/light_seed_bronze.png'));",
    '});',
    ''
  ].join('\n');
}

async function stage(request) {
  const [rankRows, specialRows] = await Promise.all([loadRankRows(), loadSpecialRows()]);
  await git(['fetch', 'origin', 'main']);
  const branch = `feat/scout-rank-seed-beta-artwork-${request.requestId.slice(5, 20).replace('T', '-')}`;
  const remote = await git(['ls-remote', '--heads', 'origin', branch]);
  if (remote.stdout) throw new Error(`Remote branch already exists: ${branch}`);
  const worktree = path.join(os.tmpdir(), `novelight-scout-special-${request.requestId}`);
  await fs.rm(worktree, { recursive: true, force: true });
  await git(['worktree', 'add', '-b', branch, worktree, 'origin/main']);
  try {
    const rankDir = path.join(worktree, 'assets', 'scout-record', 'ranks');
    const seedDir = path.join(worktree, 'assets', 'scout-record', 'light-seed');
    const badgeDir = path.join(worktree, 'assets', 'scout-badges');
    await Promise.all([fs.mkdir(rankDir, { recursive: true }), fs.mkdir(seedDir, { recursive: true }), fs.mkdir(badgeDir, { recursive: true })]);
    for (const row of rankRows) await fs.writeFile(path.join(rankDir, row.targetName), row.bytes);
    for (const row of specialRows) await fs.writeFile(path.join(row.role === 'BETA' ? badgeDir : seedDir, row.targetName), row.bytes);

    const scriptPath = path.join(worktree, 'novelight-scout-record.js');
    const htmlPath = path.join(worktree, 'scout-record.html');
    const cssPath = path.join(worktree, 'novelight-scout-record.css');
    const [script, html, css] = await Promise.all([fs.readFile(scriptPath, 'utf8'), fs.readFile(htmlPath, 'utf8'), fs.readFile(cssPath, 'utf8')]);
    await fs.writeFile(scriptPath, patchScript(script, rankRows), 'utf8');
    await fs.writeFile(htmlPath, patchHtml(html), 'utf8');
    await fs.writeFile(cssPath, patchCss(css), 'utf8');

    const manifestPath = path.join(worktree, 'docs', 'SCOUT-SPECIAL-ARTWORK-MANIFEST.json');
    const testPath = path.join(worktree, 'tests', 'scout-special-artwork.test.mjs');
    await fs.writeFile(manifestPath, buildManifest(rankRows, specialRows), 'utf8');
    await fs.writeFile(testPath, buildTest(rankRows, specialRows), 'utf8');

    const assetPaths = [...rankRows.map(row => `assets/scout-record/ranks/${row.targetName}`), ...specialRows.map(row => row.role === 'BETA' ? `assets/scout-badges/${row.targetName}` : `assets/scout-record/light-seed/${row.targetName}`)];
    const textPaths = ['novelight-scout-record.js', 'scout-record.html', 'novelight-scout-record.css', 'docs/SCOUT-SPECIAL-ARTWORK-MANIFEST.json', 'tests/scout-special-artwork.test.mjs'];
    await git(['add', ...assetPaths, ...textPaths], worktree);
    const expectedStaged = [...assetPaths, ...textPaths].sort();
    const staged = (await git(['diff', '--cached', '--name-only'], worktree)).stdout.split(/\r?\n/).filter(Boolean).sort();
    if (JSON.stringify(staged) !== JSON.stringify(expectedStaged)) throw new Error(`Unexpected staged paths: ${JSON.stringify(staged)}`);
    await execFileAsync(process.execPath, ['--test', 'tests/scout-special-artwork.test.mjs'], { cwd: worktree, windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
    await git(['commit', '-m', 'Register approved SCOUT special artwork'], worktree);
    const commit = (await git(['rev-parse', 'HEAD'], worktree)).stdout;
    await git(['push', '-u', 'origin', branch], worktree);
    return { nloRoute: 'github_bridge', remoteDesktopCommanderDependency: false, sourceRankZip: RANK_ZIP, sourceRankZipSha256: RANK_ZIP_SHA256, sourceSpecialZip: SPECIAL_ZIP, sourceSpecialZipSha256: SPECIAL_ZIP_SHA256, rankCount: rankRows.length, specialCount: specialRows.length, branch, commit, result: 'STAGED_AND_PUSHED' };
  } finally {
    await git(['worktree', 'remove', '--force', worktree]).catch(() => {});
  }
}

async function postResult(request, status, details) {
  const body = [RESULT_PREFIX, '', `- request_id: \`${request.requestId}\``, '- action: `scout_special_register`', `- status: **${status}**`, `- observed_at: \`${new Date().toISOString()}\``, '', '~~~json', typeof details === 'string' ? details : JSON.stringify(details, null, 2), '~~~'].join('\n');
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
      console.error('[NLO scout-special-register] invalid request:', error instanceof Error ? error.message : String(error));
    }
  }
  if (!requests.length) return;
  requests.sort((a, b) => a.commentId - b.commentId);
  const target = requests.at(-1).request;
  const completed = (comments || []).some(comment => String(comment.body || '').startsWith(RESULT_PREFIX) && String(comment.body || '').includes(`- request_id: \`${target.requestId}\``));
  if (completed) return;
  try {
    await postResult(target, 'success', await stage(target));
  } catch (error) {
    await postResult(target, 'failure', error instanceof Error ? error.stack || error.message : String(error));
  }
}

void processPendingRequest().catch(error => {
  console.error('[NLO scout-special-register] startup failed:', error);
});
