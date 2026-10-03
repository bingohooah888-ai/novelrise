import fs from 'node:fs/promises';
import { createSecurityConfig } from '../src/security.js';
import { copyAssetBatch, copyAssetExact, finalizeAssetWorktree, prepareAssetWorktree, verifyAsset } from '../src/asset-pipeline.js';

function parseArgs(argv) {
  const command = argv[0];
  const options = {};
  for (let i = 1; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) throw new Error('Unexpected argument: ' + token);
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) options[key] = true;
    else { options[key] = next; i += 1; }
  }
  return { command, options };
}

function number(value) { return value == null ? undefined : Number(value); }
function boolean(value) { return value === true || /^(1|true|yes|on)$/i.test(String(value || '')); }

async function manifest(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

const security = createSecurityConfig();
const { command, options } = parseArgs(process.argv.slice(2));
let result;

if (command === 'verify') {
  result = await verifyAsset(options.file, {
    sha256: options.sha256,
    size: number(options.size),
    width: number(options.width),
    height: number(options.height),
    format: options.format
  }, security);
} else if (command === 'add') {
  result = await copyAssetExact(options.source, options.destination, {
    overwrite: boolean(options.overwrite),
    expected: {
      sha256: options.sha256,
      size: number(options.size),
      width: number(options.width),
      height: number(options.height),
      format: options.format
    }
  }, security);
} else if (command === 'batch') {
  const data = await manifest(options.manifest);
  result = await copyAssetBatch(data.items || data.files, security);
} else if (command === 'prepare') {
  result = await prepareAssetWorktree(options.repo || '.', options.worktree, options.branch, security);
} else if (command === 'finalize') {
  const data = await manifest(options.manifest);
  result = await finalizeAssetWorktree(
    options.worktree || data.worktree,
    data.commitFiles || data.files?.map(item => item.destination),
    options.message || data.message || 'Add NOVELIGHT image assets',
    boolean(options.push),
    security
  );
} else {
  throw new Error('Usage: asset-pipeline.mjs <verify|add|batch|prepare|finalize> [--options]');
}

process.stdout.write(JSON.stringify(result, null, 2) + '\n');
