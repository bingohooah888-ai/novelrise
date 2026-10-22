// Owner-approved, narrow bridge to stage the two adopted Star Festival WebP assets.
// Reads only one ZIP from the Windows user's Downloads; updates only PR #2305.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import JSZip from 'jszip';

const REPO = 'bingohooah888-ai/novelrise';
const BRANCH = 'feat/contest-home-responsive-banner-20261016';
const PR = 2305;
const ZIP = 'novelight-star-festival-banner-assets.zip';
const ASSETS = Object.freeze([
  {
    name: 'assets/contest/starfestival-entry-desktop.webp',
    size: 257812,
    sha256: '26c6b5cab5c7fa34eb8727c8b154968f431dad928a2be96759d5076dadd267b2'
  },
  {
    name: 'assets/contest/starfestival-entry-mobile.webp',
    size: 284738,
    sha256: '460cd417b12849cf492534f3a90cefbcce621548808b457957bd3cb5784dc887'
  }
]);

function exactKeys(obj, expected) {
  return Boolean(obj && typeof obj === 'object' && !Array.isArray(obj)) &&
    JSON.stringify(Object.keys(obj).sort()) === JSON.stringify([...expected].sort());
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export async function inspectContestBannerZip(buffer) {
  const zip = await JSZip.loadAsync(buffer, { checkCRC32: true });
  const files = Object.values(zip.files).filter(x => !x.dir).map(x => x.name).sort();
  if (JSON.stringify(files) !== JSON.stringify(ASSETS.map(x => x.name).sort())) {
    throw new Error('ZIP contents differ from the two approved Star Festival banners.');
  }
  const verified = [];
  for (const item of ASSETS) {
    const data = await zip.file(item.name).async('nodebuffer');
    if (data.length !== item.size || sha256(data) !== item.sha256) {
      throw new Error('Approved asset hash or byte count mismatch: ' + item.name);
    }
    if (data.toString('ascii', 0, 4) !== 'RIFF' ||
        data.toString('ascii', 8, 12) !== 'WEBP') {
      throw new Error('Asset is not WebP: ' + item.name);
    }
    verified.push({ ...item, bytes: data });
  }
  return verified;
}

function git(args, cwd, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, shell: false, windowsHide: true });
    let stdout = '';
    let stderr = '';
    let done = false;
    const timer = setTimeout(() => {
      child.kill();
      if (!done) { done = true; reject(new Error('git process timed out.')); }
    }, timeoutMs);
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', error => {
      clearTimeout(timer);
      if (!done) { done = true; reject(error); }
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (done) return;
      done = true;
      if (code !== 0) reject(new Error('git ' + args[0] + ' failed: ' + stderr.slice(0, 1200)));
      else resolve(stdout.trim());
    });
  });
}

async function verifyPull(expectedHead) {
  const token = String(process.env.NOVELIGHT_BRIDGE_GITHUB_TOKEN || '').trim();
  if (!token) throw new Error('NLO GitHub credential is unavailable.');
  const response = await fetch('https://api.github.com/repos/' + REPO + '/pulls/' + PR, {
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    },
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw new Error('Could not verify target Draft PR.');
  const pr = await response.json();
  if (pr.state !== 'open' || !pr.draft || pr.base?.ref !== 'main' ||
      pr.head?.repo?.full_name !== REPO || pr.head?.ref !== BRANCH ||
      pr.head?.sha !== expectedHead) {
    throw new Error('PR identity, draft status, or head SHA has changed.');
  }
}

export async function actionContestBannerStage(request, config) {
  if (!exactKeys(request.args, ['expectedHeadSha', 'confirmation']) ||
      request.args.confirmation !== 'CHAT_APPROVED') {
    throw new Error('contest_banner_stage requires expectedHeadSha and CHAT_APPROVED.');
  }
  const expectedHead = String(request.args.expectedHeadSha || '').toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(expectedHead)) throw new Error('Invalid expected PR SHA.');
  await verifyPull(expectedHead);

  const archivePath = path.join(os.homedir(), 'Downloads', ZIP);
  const archive = await fs.readFile(archivePath).catch(error => {
    if (error?.code === 'ENOENT') {
      throw new Error('Please save the approved ZIP to the PC Downloads folder as ' + ZIP);
    }
    throw error;
  });
  const approved = await inspectContestBannerZip(archive);

  const repoRoot = path.resolve(String(config.repoRoot || ''));
  await git(['fetch', '--no-tags', 'origin', 'refs/heads/' + BRANCH], repoRoot);
  const fetchedHead = await git(['rev-parse', 'FETCH_HEAD'], repoRoot);
  if (fetchedHead !== expectedHead) throw new Error('Remote PR head changed; no write made.');

  const worktree = path.join(os.tmpdir(), 'nlo-contest-banner-' + request.requestId);
  try {
    await git(['worktree', 'add', '--detach', worktree, fetchedHead], repoRoot);
    for (const item of approved) {
      const target = path.join(worktree, ...item.name.split('/'));
      try {
        await fs.access(target);
        throw new Error('Refusing to overwrite existing banner: ' + item.name);
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, item.bytes, { flag: 'wx' });
    }
    const files = ASSETS.map(item => item.name);
    await git(['add', '--', ...files], worktree);
    const staged = (await git(['diff', '--cached', '--name-only'], worktree))
      .split(/\r?\n/).filter(Boolean).sort();
    if (JSON.stringify(staged) !== JSON.stringify([...files].sort())) {
      throw new Error('Staged files differ from two authorized WebP assets.');
    }
    await git(['diff', '--cached', '--check'], worktree);
    await git([
      '-c', 'user.name=NOVELIGHT Commander',
      '-c', 'user.email=nlo@novelight.local',
      'commit', '-m', 'Add adopted lightweight Star Festival banners'
    ], worktree);
    const commit = await git(['rev-parse', 'HEAD'], worktree);
    await git(['push', 'origin', 'HEAD:refs/heads/' + BRANCH], worktree, 180000);
    return [
      'result: BRANCH_PUSHED',
      'pr: ' + PR,
      'branch: ' + BRANCH,
      'head_sha: ' + commit,
      'approved_assets: 2',
      ...approved.map(a => a.name + ': ' + a.size + ' bytes; sha256=' + a.sha256),
      'production_merged: false'
    ].join('\n');
  } finally {
    await git(['worktree', 'remove', '--force', worktree], repoRoot).catch(() => {});
  }
}
