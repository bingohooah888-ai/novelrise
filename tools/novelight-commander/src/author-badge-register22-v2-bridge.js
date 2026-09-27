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
const EXPECTED_COUNT = 22;
const EXPECTED_WIDTH = 1254;
const EXPECTED_HEIGHT = 1254;
const SOURCE_ZIP_NAME = 'NOVELIGHT_Author_Normal_30_images.zip';
const EXPECTED_ZIP_SHA256 = '3c8bb8937b71a936f60fbddefe2f87d4a593a0bb759e11fa3d953ea3525480d4';
const POLL_INTERVAL_MS = 10_000;
const COMMENT_LOOKBACK_MS = 6 * 60 * 60 * 1000;
const MAX_COMMENT_PAGES = 20;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../..');
const SOURCE_ZIP = path.join(os.homedir(), 'Downloads', SOURCE_ZIP_NAME);

const TARGETS = [
  { fileName: 'Author_Normal_009.png', badgeId: 'author_chars_250k', sha256: '01843a0b5a414cb5bce05f7ca356f19290848e942458bdf817086fd394fb3f73' },
  { fileName: 'Author_Normal_010.png', badgeId: 'author_chars_500k', sha256: 'c3811b17b964802de58debca7a8e21f778a102f26e05d032e3165c2f94f4128a' },
  { fileName: 'Author_Normal_011.png', badgeId: 'author_completed_001', sha256: 'd3cbf04309cd621e68400ccfa5ff1e52028d0b3a3fbb3a31ba890adfc39e67b5' },
  { fileName: 'Author_Normal_012.png', badgeId: 'author_completed_003', sha256: '8cec0a7e4056016b091f772dd27d8b51ad80b61faab55934ad677abf4c8f54dd' },
  { fileName: 'Author_Normal_013.png', badgeId: 'author_completed_005', sha256: '115ed69cf72b44b74e33fc4c2e7409e7f99778f1dcae27a8c106b71d5e318382' },
  { fileName: 'Author_Normal_014.png', badgeId: 'author_novel_002', sha256: '745d2f8621246bea67a78e3d1bdd6eec018061b2829ed4ea4a530d44f2e4b70a' },
  { fileName: 'Author_Normal_015.png', badgeId: 'author_novel_005', sha256: '3a432553f69580e608bfd19db007415317d982b3ad4ac516cfc1d9baa16632bd' },
  { fileName: 'Author_Normal_016.png', badgeId: 'author_novel_010', sha256: '77f058d90cea373b4ee4a6b3d5cd47b1b7b1b199f97cdd47f65291aef1910b2f' },
  { fileName: 'Author_Normal_017.png', badgeId: 'author_unique_reader_010', sha256: '31c09c3a52512707574ddd7b822a1e719ff80d141c4ca4eaaf6187fca210c2d0' },
  { fileName: 'Author_Normal_018.png', badgeId: 'author_unique_reader_050', sha256: 'b0d90c545219b7d48ae173f13982bd7ae3cb3dadca7b42705ad18b2fbad656d6' },
  { fileName: 'Author_Normal_019.png', badgeId: 'author_unique_reader_100', sha256: '76bec398610ea9c751c74a37e5b611515015852552b0bd36e4f5ac86bf1bc822' },
  { fileName: 'Author_Normal_020.png', badgeId: 'author_unique_reader_500', sha256: '7b8754bf42cb58b246e02993abe68fc13f20c3592457f43a9fa4005de813ebad' },
  { fileName: 'Author_Normal_021.png', badgeId: 'author_favorite_010', sha256: 'e72801424d693085908da480f03b2b5143caf7b54de5c5f9533ffe0255d72ccc' },
  { fileName: 'Author_Normal_022.png', badgeId: 'author_favorite_050', sha256: '6b19b03b17234a72ca9a97cd31abc479038a6a21dc49e2a81434d4bec820e553' },
  { fileName: 'Author_Normal_023.png', badgeId: 'author_favorite_100', sha256: 'af67f55b989e9b9cf12cf77a75584382508cb319aa346de058cd41bccd9cde0e' },
  { fileName: 'Author_Normal_024.png', badgeId: 'author_comment_010', sha256: '98cfbaa33e65698dc254a321193f0ea2747a10879c8050f31d0b9528335899f2' },
  { fileName: 'Author_Normal_025.png', badgeId: 'author_comment_050', sha256: 'd56802a2adb089d83f08037e96a51fe4d1281a81ef2a60136d99c85a94ee82f3' },
  { fileName: 'Author_Normal_026.png', badgeId: 'author_seed_received_001', sha256: '17358458831af76a3a47cb90d5bc171801103e4c607c1a6528f2cada50a61769' },
  { fileName: 'Author_Normal_027.png', badgeId: 'author_seed_received_010', sha256: '7bde60883124c70da72352a132e7e44853fced38f5184b86b4fd98724f1c3695' },
  { fileName: 'Author_Normal_028.png', badgeId: 'author_seed_received_050', sha256: '6df6410efa64e19b3407a1036accc4a23407873e7a93be26cfab0e8a4c349d73' },
  { fileName: 'Author_Normal_029.png', badgeId: 'author_discovered_plus2_001', sha256: '2f044b87a5b009adea7bbe7718314557932765948bd8e100766b9cdc2d91eb47' },
  { fileName: 'Author_Normal_030.png', badgeId: 'author_discovered_plus3_001', sha256: '54a017d60134abb6cab5915594af0bda35beaaf60a535fa9fea0dd8d5e68d4b9' }
];

if (TARGETS.length !== EXPECTED_COUNT) {
  throw new Error(`Author badge register22 contract expected ${EXPECTED_COUNT} targets, got ${TARGETS.length}`);
}

function token() {
  return String(process.env.NOVELIGHT_BRIDGE_GITHUB_TOKEN || '').trim();
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function githubApi(method, apiPath, body) {
  const response = await fetch('https://api.github.com' + apiPath, {
    method,
    headers: {
      Authorization: 'Bearer ' + token(),
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'NOVELIGHT-Commander-Author-Badge-Register22-V2'
    },
    body: body == null ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000)
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
    request.version !== 1 ||
    request.action !== 'author_badge_register22' ||
    !REQUEST_ID_RE.test(String(request.requestId || '')) ||
    request?.args?.confirmation !== CONFIRMATION ||
    Object.keys(request.args || {}).sort().join(',') !== 'confirmation'
  ) {
    throw new Error('Author badge register22 request does not match the fixed contract.');
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
  if (bytes.length < 24 || bytes.toString('hex', 0, 8) !== '89504e470d0a1a0a') {
    throw new Error('Invalid PNG');
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

async function loadTargets() {
  const zipBytes = await fs.readFile(SOURCE_ZIP);
  const zipSha256 = sha256(zipBytes);
  if (zipSha256 !== EXPECTED_ZIP_SHA256) {
    throw new Error(`Official Author Normal ZIP SHA256 mismatch: ${zipSha256}`);
  }
  const zip = await JSZip.loadAsync(zipBytes);
  const rows = [];
  for (const target of TARGETS) {
    const entry = zip.file(target.fileName);
    if (!entry) throw new Error(`Source ZIP missing ${target.fileName}`);
    const bytes = await entry.async('nodebuffer');
    const geometry = pngGeometry(bytes);
    if (geometry.width !== EXPECTED_WIDTH || geometry.height !== EXPECTED_HEIGHT) {
      throw new Error(`${target.fileName} unexpected geometry ${geometry.width}x${geometry.height}`);
    }
    const actualSha = sha256(bytes);
    if (actualSha !== target.sha256) {
      throw new Error(`${target.fileName} SHA256 mismatch: ${actualSha}`);
    }
    rows.push({ ...target, bytes, size: bytes.length, ...geometry });
  }
  if (rows.length !== EXPECTED_COUNT) {
    throw new Error(`Validated target count mismatch: ${rows.length}`);
  }
  return { rows, zipSha256 };
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
    const existingPattern = new RegExp(`\\n\\s*${row.badgeId}:\\s*['\"]([^'\"]+)['\"]`);
    const match = objectText.match(existingPattern);
    if (match) {
      if (match[1] !== expected) {
        throw new Error(`${row.badgeId} already mapped to unexpected ${match[1]}`);
      }
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
  const lines = [
    'expected_count,order,source_file,badge_id,asset_path,sha256,size_bytes,width,height,source_zip,source_zip_sha256'
  ];
  rows.forEach((row, index) => lines.push([
    EXPECTED_COUNT,
    index + 9,
    row.fileName,
    row.badgeId,
    `assets/scout-badges/${row.badgeId}.png`,
    row.sha256,
    row.size,
    row.width,
    row.height,
    SOURCE_ZIP_NAME,
    zipSha256
  ].map(csvEscape).join(',')));
  return lines.join('\n') + '\n';
}

function buildTest(rows) {
  const expected = rows
    .map(row => `  ['${row.badgeId}', '${row.fileName}', '${row.sha256}']`)
    .join(',\n');
  return [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import fs from 'node:fs';",
    "import crypto from 'node:crypto';",
    '',
    "const EXPECTED_ZIP_SHA256 = '" + EXPECTED_ZIP_SHA256 + "';",
    'const expected = [',
    expected,
    '];',
    '',
    "test('Author Normal #9-#30 artwork keeps approved original bytes and UI mappings', () => {",
    "  const script = fs.readFileSync('novelight-scout-record.js', 'utf8');",
    "  const manifest = fs.readFileSync('docs/SCOUT-BADGE-AUTHOR-NORMAL-09-30-MANIFEST.csv', 'utf8');",
    '  assert.equal(expected.length, ' + EXPECTED_COUNT + ');',
    '  assert.ok(manifest.includes(EXPECTED_ZIP_SHA256));',
    "  assert.ok(manifest.startsWith('expected_count,order,source_file,badge_id,asset_path,sha256,size_bytes,width,height,source_zip,source_zip_sha256\\n'));",
    '  for (const [badgeId, sourceFile, expectedSha] of expected) {',
    "    const file = 'assets/scout-badges/' + badgeId + '.png';",
    '    const bytes = fs.readFileSync(file);',
    "    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', badgeId);",
    '    assert.equal(bytes.readUInt32BE(16), ' + EXPECTED_WIDTH + ', badgeId);',
    '    assert.equal(bytes.readUInt32BE(20), ' + EXPECTED_HEIGHT + ', badgeId);',
    "    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), expectedSha, badgeId);",
    "    assert.ok(script.includes(badgeId + \": 'assets/scout-badges/\" + badgeId + \".png'\"), badgeId);",
    '    assert.ok(manifest.includes(sourceFile), sourceFile);',
    '    assert.ok(manifest.includes(expectedSha), expectedSha);',
    '  }',
    '});',
    ''
  ].join('\n');
}

async function verifyWorktreeFiles(worktree, rows) {
  for (const row of rows) {
    const relative = `assets/scout-badges/${row.badgeId}.png`;
    const bytes = await fs.readFile(path.join(worktree, relative));
    if (sha256(bytes) !== row.sha256) {
      throw new Error(`${relative} does not preserve approved source bytes`);
    }
    const geometry = pngGeometry(bytes);
    if (geometry.width !== EXPECTED_WIDTH || geometry.height !== EXPECTED_HEIGHT) {
      throw new Error(`${relative} geometry changed`);
    }
  }
}

async function runGeneratedContractTest(worktree) {
  const { stdout = '', stderr = '' } = await execFileAsync(
    process.execPath,
    ['--test', 'tests/scout-author-normal-09-30-artwork.test.mjs'],
    { cwd: worktree, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }
  );
  return { stdout: String(stdout).trim(), stderr: String(stderr).trim() };
}

function registrationDetails(rows, zipSha256, branch, commitSha, recoveredExistingBranch = false) {
  return {
    nloRoute: 'github_bridge',
    remoteDesktopCommanderDependency: false,
    branch,
    commitSha,
    recoveredExistingBranch,
    sourceZip: SOURCE_ZIP_NAME,
    sourceZipSha256: zipSha256,
    expectedCount: EXPECTED_COUNT,
    registeredCount: rows.length,
    imageProcessing: 'none',
    badgeIds: rows.map(row => row.badgeId),
    assets: rows.map(row => ({
      badgeId: row.badgeId,
      fileName: row.fileName,
      sha256: row.sha256,
      size: row.size,
      geometry: `${row.width}x${row.height}`
    }))
  };
}

async function stage(request) {
  const { rows, zipSha256 } = await loadTargets();
  await git(['fetch', 'origin', 'main']);
  const branch = `feat/scout-author-normal-09-30-${request.requestId.slice(5, 20).replace('T', '-')}`;
  const remote = await git(['ls-remote', '--heads', 'origin', branch]);
  if (remote.stdout) {
    const commitSha = remote.stdout.split(/\s+/)[0];
    return registrationDetails(rows, zipSha256, branch, commitSha, true);
  }

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
        if (sha256(existing) !== row.sha256) {
          throw new Error(`${row.badgeId} existing asset hash mismatch`);
        }
      } catch (error) {
        if (error?.code === 'ENOENT') {
          await fs.writeFile(target, row.bytes);
        } else {
          throw error;
        }
      }
    }

    const scriptPath = path.join(worktree, 'novelight-scout-record.js');
    const script = await fs.readFile(scriptPath, 'utf8');
    await fs.writeFile(scriptPath, insertMappings(script, rows), 'utf8');
    const manifestPath = path.join(worktree, 'docs', 'SCOUT-BADGE-AUTHOR-NORMAL-09-30-MANIFEST.csv');
    const testPath = path.join(worktree, 'tests', 'scout-author-normal-09-30-artwork.test.mjs');
    await fs.writeFile(manifestPath, buildManifest(rows, zipSha256), 'utf8');
    await fs.writeFile(testPath, buildTest(rows), 'utf8');

    await verifyWorktreeFiles(worktree, rows);
    const contractTest = await runGeneratedContractTest(worktree);
    await git(['diff', '--check'], worktree);

    const pathsToAdd = [
      ...rows.map(row => `assets/scout-badges/${row.badgeId}.png`),
      'novelight-scout-record.js',
      'docs/SCOUT-BADGE-AUTHOR-NORMAL-09-30-MANIFEST.csv',
      'tests/scout-author-normal-09-30-artwork.test.mjs'
    ];
    await git(['add', '--', ...pathsToAdd], worktree);
    const staged = await git(['diff', '--cached', '--name-only'], worktree);
    const stagedFiles = staged.stdout.split(/\r?\n/).filter(Boolean);
    const allowedFiles = new Set(pathsToAdd);
    const unexpected = stagedFiles.filter(file => !allowedFiles.has(file));
    if (unexpected.length) {
      throw new Error(`Unexpected staged files: ${unexpected.join(', ')}`);
    }

    await verifyWorktreeFiles(worktree, rows);
    const status = await git(['status', '--porcelain'], worktree);
    if (!stagedFiles.length) {
      throw new Error(`No registration changes to commit. status=${status.stdout || 'clean'}`);
    }

    await git(['commit', '-m', 'Register Author Normal artwork #9-#30'], worktree);
    const commitSha = (await git(['rev-parse', 'HEAD'], worktree)).stdout;
    await git(['push', '-u', 'origin', branch], worktree);
    return {
      ...registrationDetails(rows, zipSha256, branch, commitSha, false),
      contractTest
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
    '- action: `author_badge_register22`',
    `- status: **${status}**`,
    `- observed_at: \`${new Date().toISOString()}\``,
    '',
    '~~~json',
    typeof details === 'string' ? details : JSON.stringify(details, null, 2),
    '~~~'
  ].join('\n');
  await githubApi('POST', `/repos/${OWNER}/${REPOSITORY}/issues/${ISSUE_NUMBER}/comments`, { body });
}

async function listRecentComments() {
  const since = new Date(Date.now() - COMMENT_LOOKBACK_MS).toISOString();
  const comments = [];
  for (let page = 1; page <= MAX_COMMENT_PAGES; page += 1) {
    const batch = await githubApi(
      'GET',
      `/repos/${OWNER}/${REPOSITORY}/issues/${ISSUE_NUMBER}/comments?per_page=100&page=${page}&since=${encodeURIComponent(since)}`
    );
    comments.push(...(batch || []));
    if (!Array.isArray(batch) || batch.length < 100) break;
  }
  return comments;
}

let processing = false;
const completedInProcess = new Set();

async function processPendingRequest() {
  if (!token() || processing) return;
  processing = true;
  try {
    const comments = await listRecentComments();
    const requests = [];
    for (const comment of comments) {
      try {
        const request = parseRequest(comment);
        if (request) requests.push({ request, commentId: Number(comment.id) });
      } catch (error) {
        console.error('[NLO author-badge-register22-v2] invalid request:', error instanceof Error ? error.message : String(error));
      }
    }
    if (!requests.length) return;
    requests.sort((a, b) => a.commentId - b.commentId);
    const target = requests.at(-1).request;
    if (completedInProcess.has(target.requestId)) return;
    const alreadyHasResult = comments.some(comment =>
      String(comment.body || '').startsWith(RESULT_PREFIX) &&
      String(comment.body || '').includes(`- request_id: \`${target.requestId}\``)
    );
    if (alreadyHasResult) {
      completedInProcess.add(target.requestId);
      return;
    }
    try {
      await postResult(target, 'success', await stage(target));
    } catch (error) {
      await postResult(target, 'failure', error instanceof Error ? error.stack || error.message : String(error));
    }
    completedInProcess.add(target.requestId);
  } finally {
    processing = false;
  }
}

void processPendingRequest().catch(error =>
  console.error('[NLO author-badge-register22-v2] startup failed:', error)
);
const pollTimer = setInterval(() => {
  void processPendingRequest().catch(error =>
    console.error('[NLO author-badge-register22-v2] poll failed:', error)
  );
}, POLL_INTERVAL_MS);
pollTimer.unref?.();
