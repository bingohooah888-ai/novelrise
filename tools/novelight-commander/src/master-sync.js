import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

export const MASTER_SYNC_CONFIRMATION = 'SYNC_CHATGPT_PROJECT_MASTER';
export const MASTER_SOURCE_PATH = 'docs/NOVELIGHT-MASTER.md';
const MASTER_NAME_RE = /^NOVELIGHT-MASTER(?:[-_.\s]|$)/i;

function bounded(value, limit = 12000) {
  const text = String(value || '').replace(
    /((?:TOKEN|API_KEY|SECRET|PASSWORD)\s*[=:]\s*)[^\s\"'\r\n]+/gi,
    '$1[REDACTED]'
  );
  return text.length <= limit ? text : text.slice(-limit) + '\n[truncated]';
}

function run(executable, args, options = {}) {
  const timeoutMs = Number(options.timeoutMs || 120000);
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
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
        reject(new Error(`Command timed out after ${timeoutMs}ms.`));
      }
    }, timeoutMs);
    child.stdout?.on('data', chunk => {
      stdout = bounded(stdout + chunk.toString(), 1000000);
    });
    child.stderr?.on('data', chunk => {
      stderr = bounded(stderr + chunk.toString(), 200000);
    });
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

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

export function isMasterCandidateFileName(name) {
  return MASTER_NAME_RE.test(String(name || '').trim());
}

export function currentMasterFileName(mainSha, contentSha) {
  const main = String(mainSha || '').toLowerCase();
  const content = String(contentSha || '').toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(main)) {
    throw new Error('mainSha must be a 40-character SHA.');
  }
  if (!/^[0-9a-f]{64}$/.test(content)) {
    throw new Error('contentSha must be a SHA-256 value.');
  }
  return `NOVELIGHT-MASTER-CURRENT-${main.slice(0, 12)}-${content.slice(0, 12)}.md`;
}

export function validateMasterText(text) {
  const value = String(text || '').replace(/^\uFEFF/u, '');
  const checks = {
    hasTitle: /(^|\n)#?\s*NOVELIGHT MASTER\s*(\n|$)/i.test(value),
    hasUpdatedAt: /最終更新：20\d{2}年\d{1,2}月\d{1,2}日/.test(value),
    hasNloDcSection: /34\.\s*NLO\s*\/\s*DC\s*絶対分離ルール/.test(value),
    hasNloIdentity: /NLO\s*=\s*NOVELIGHT Commander/.test(value),
    hasDcIdentity: /DC\s*=\s*Remote Desktop Commander\s*\/\s*Desktop Commander/.test(value),
    longEnough: value.length >= 10000
  };
  const failed = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  if (failed.length) {
    throw new Error('MASTER validation failed: ' + failed.join(', '));
  }
  return checks;
}

async function git(args, repoRoot, timeoutMs = 120000) {
  const result = await run('git', args, { cwd: repoRoot, timeoutMs });
  if (result.code !== 0) {
    throw new Error(
      `git ${args.join(' ')} failed.\n${bounded(result.stderr || result.stdout, 8000)}`
    );
  }
  return result.stdout;
}

export async function prepareLatestMaster({ repoRoot, dataRoot }) {
  const repoValue = String(repoRoot || '').trim();
  const dataValue = String(dataRoot || '').trim();
  if (!repoValue || !dataValue) {
    throw new Error('repoRoot and dataRoot are required.');
  }
  const root = path.resolve(repoValue);
  const data = path.resolve(dataValue);

  await git(['fetch', 'origin', 'main', '--prune'], root);
  const mainSha = (await git(['rev-parse', 'origin/main'], root)).trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(mainSha)) {
    throw new Error('origin/main did not resolve to a commit SHA.');
  }

  const text = await git(['show', `${mainSha}:${MASTER_SOURCE_PATH}`], root);
  validateMasterText(text);
  const contentSha = sha256(text);
  const fileName = currentMasterFileName(mainSha, contentSha);
  const directory = path.join(data, 'master-sync');
  const file = path.join(directory, fileName);
  const manifest = path.join(directory, 'CURRENT.json');

  await fs.mkdir(directory, { recursive: true });
  const temp = file + '.tmp';
  await fs.writeFile(temp, text, 'utf8');
  await fs.rename(temp, file);

  const payload = {
    preparedAt: new Date().toISOString(),
    source: `origin/main:${MASTER_SOURCE_PATH}`,
    mainSha,
    contentSha256: contentSha,
    fileName,
    file,
    bytes: Buffer.byteLength(text, 'utf8')
  };
  const manifestTemp = manifest + '.tmp';
  await fs.writeFile(manifestTemp, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  await fs.rename(manifestTemp, manifest);
  return payload;
}
