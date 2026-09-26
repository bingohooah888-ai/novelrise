import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import JSZip from 'jszip';
import { PNG } from 'pngjs';

const FILE_NAME = 'NOVELIGHT_Reader_Normal_31-80_Approved_50.zip';
const TRANSFER_BRANCH = 'novelight-transfer/scout-reader-normal-31-80-approved-50';
const PREFIX = 'NOVELIGHT_Reader_Normal_31-80_Approved/';
const EXPECTED_NUMBERS = Array.from({ length: 50 }, (_, index) => index + 31);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || repoRoot,
      shell: false,
      windowsHide: true,
      env: process.env
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr?.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell.replace(/\r$/u, ''));
      if (row.some(value => value !== '')) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell.replace(/\r$/u, ''));
    rows.push(row);
  }
  const [header, ...body] = rows;
  return body.map(values => Object.fromEntries(header.map((key, index) => [key, values[index] ?? ''])));
}

async function ensureRepoReady() {
  const status = await run('git', ['status', '--porcelain']);
  if (status.code !== 0 || status.stdout.trim()) {
    throw new Error('SCOUT badge transfer requires a clean local working tree.');
  }
  const branch = await run('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch.code !== 0 || branch.stdout.trim() !== 'main') {
    throw new Error('SCOUT badge transfer requires local main.');
  }
  const fetch = await run('git', ['fetch', 'origin', 'main', '--prune']);
  if (fetch.code !== 0) throw new Error(`git fetch origin main failed.\n${fetch.stderr}`);
  const [head, originMain] = await Promise.all([
    run('git', ['rev-parse', 'HEAD']),
    run('git', ['rev-parse', 'origin/main'])
  ]);
  if (head.stdout.trim() !== originMain.stdout.trim()) {
    throw new Error('SCOUT badge transfer requires local main to exactly match origin/main.');
  }
  return originMain.stdout.trim();
}

async function remoteAlreadyExists() {
  const result = await run('git', ['ls-remote', '--exit-code', '--heads', 'origin', `refs/heads/${TRANSFER_BRANCH}`]);
  return result.code === 0 && result.stdout.trim() !== '';
}

async function loadAndValidatePack(zipPath) {
  const zip = await JSZip.loadAsync(await fs.readFile(zipPath));
  const fileEntries = Object.values(zip.files).filter(entry => !entry.dir);
  const expectedNames = new Set([
    `${PREFIX}README.txt`,
    `${PREFIX}manifest.csv`,
    ...EXPECTED_NUMBERS.map(number => `${PREFIX}Reader_Normal_${String(number).padStart(3, '0')}.png`)
  ]);
  const actualNames = new Set(fileEntries.map(entry => entry.name));
  if (actualNames.size !== expectedNames.size || [...expectedNames].some(name => !actualNames.has(name))) {
    throw new Error('Approved Reader Normal ZIP file set mismatch.');
  }

  const manifestText = (await zip.file(`${PREFIX}manifest.csv`).async('string')).replace(/^\uFEFF/u, '');
  const rows = parseCsv(manifestText);
  if (rows.length !== 50) throw new Error(`Reader Normal manifest row count mismatch: ${rows.length}`);
  const rowByNumber = new Map(rows.map(row => [Number(row.badge_no), row]));
  if (rowByNumber.size !== 50) throw new Error('Reader Normal manifest badge_no contains duplicates.');

  const assets = [];
  for (const number of EXPECTED_NUMBERS) {
    const row = rowByNumber.get(number);
    if (!row) throw new Error(`Reader Normal manifest missing badge #${number}.`);
    const filename = `Reader_Normal_${String(number).padStart(3, '0')}.png`;
    if (row.packaged_filename !== filename) throw new Error(`Packaged filename mismatch for badge #${number}.`);
    if (row.width !== '1254' || row.height !== '1254' || row.mode !== 'RGBA') {
      throw new Error(`Manifest geometry/mode mismatch for badge #${number}.`);
    }
    if (row.alpha_min !== '0' || row.alpha_max !== '255' || row.corner_alpha !== '0/0/0/0') {
      throw new Error(`Manifest alpha contract mismatch for badge #${number}.`);
    }

    const bytes = await zip.file(`${PREFIX}${filename}`).async('nodebuffer');
    if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      throw new Error(`PNG signature mismatch for badge #${number}.`);
    }
    if (sha256(bytes) !== row.packaged_sha256) throw new Error(`SHA-256 mismatch for badge #${number}.`);
    const png = PNG.sync.read(bytes);
    if (png.width !== 1254 || png.height !== 1254 || png.colorType !== 6) {
      throw new Error(`Decoded PNG contract mismatch for badge #${number}.`);
    }
    let alphaMin = 255;
    let alphaMax = 0;
    for (let index = 3; index < png.data.length; index += 4) {
      alphaMin = Math.min(alphaMin, png.data[index]);
      alphaMax = Math.max(alphaMax, png.data[index]);
    }
    const corners = [
      png.data[3],
      png.data[(png.width - 1) * 4 + 3],
      png.data[((png.height - 1) * png.width) * 4 + 3],
      png.data[(png.height * png.width - 1) * 4 + 3]
    ];
    if (alphaMin !== 0 || alphaMax !== 255 || corners.some(value => value !== 0)) {
      throw new Error(`Decoded alpha contract mismatch for badge #${number}.`);
    }
    assets.push({ number, filename, bytes, sha256: row.packaged_sha256 });
  }
  return { manifestText, assets };
}

async function stagePack(originMain, pack) {
  const worktree = path.join(os.tmpdir(), 'novelight-scout-reader-normal-31-80-transfer');
  await fs.rm(worktree, { recursive: true, force: true });
  const add = await run('git', ['worktree', 'add', '-b', TRANSFER_BRANCH, worktree, 'origin/main']);
  if (add.code !== 0) throw new Error(`Temporary SCOUT transfer worktree creation failed.\n${add.stderr}`);
  try {
    const transferDir = path.join(worktree, '.novelight-transfer', 'scout-badges-reader-normal-31-80');
    await fs.mkdir(transferDir, { recursive: true });
    for (const asset of pack.assets) {
      await fs.writeFile(path.join(transferDir, asset.filename), asset.bytes);
    }
    await fs.writeFile(path.join(transferDir, 'manifest.csv'), pack.manifestText, 'utf8');
    const addFiles = await run('git', ['add', '--', '.novelight-transfer/scout-badges-reader-normal-31-80'], { cwd: worktree });
    if (addFiles.code !== 0) throw new Error(`git add for SCOUT badge transfer failed.\n${addFiles.stderr}`);
    const commit = await run('git', ['commit', '-m', 'Stage approved Reader Normal badge originals'], { cwd: worktree });
    if (commit.code !== 0) throw new Error(`SCOUT badge transfer commit failed.\n${commit.stderr}`);
    const push = await run('git', ['push', 'origin', `HEAD:refs/heads/${TRANSFER_BRANCH}`], { cwd: worktree });
    if (push.code !== 0) throw new Error(`SCOUT badge transfer branch push failed.\n${push.stderr}`);
    const sha = await run('git', ['rev-parse', 'HEAD'], { cwd: worktree });
    console.log(`scout_badge_transfer: success\ncount: 50\ndimensions: 1254x1254\ntransfer_branch: ${TRANSFER_BRANCH}\ntransfer_sha: ${sha.stdout.trim()}\napproved_main_sha: ${originMain}`);
  } finally {
    await run('git', ['worktree', 'remove', '--force', worktree]).catch(() => {});
    await run('git', ['branch', '-D', TRANSFER_BRANCH]).catch(() => {});
  }
}

if (!process.env.NOVELIGHT_BRIDGE_CONFIG) {
  console.log('scout_badge_transfer: skipped (not NLO bridge runtime)');
  process.exit(0);
}

const zipPath = path.join(os.homedir(), 'Downloads', FILE_NAME);
const stat = await fs.stat(zipPath).catch(error => {
  if (error?.code === 'ENOENT') throw new Error(`Approved Reader Normal ZIP not found in Downloads: ${FILE_NAME}`);
  throw error;
});
if (!stat.isFile()) throw new Error('Approved Reader Normal ZIP path is not a file.');
const originMain = await ensureRepoReady();
if (await remoteAlreadyExists()) {
  console.log(`scout_badge_transfer: already_staged\ncount: 50\ntransfer_branch: ${TRANSFER_BRANCH}\napproved_main_sha: ${originMain}`);
  process.exit(0);
}
const pack = await loadAndValidatePack(zipPath);
await stagePack(originMain, pack);
