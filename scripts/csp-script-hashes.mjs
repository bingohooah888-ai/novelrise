import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('../', import.meta.url)));
const inlineScriptPattern =
  /<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/giu;

export function collectInlineScriptHashes(root = repositoryRoot) {
  const hashes = new Set();
  const htmlFiles = readdirSync(root)
    .filter((name) => extname(name) === '.html')
    .sort();

  for (const file of htmlFiles) {
    const html = readFileSync(resolve(root, file), 'utf8');
    for (const match of html.matchAll(inlineScriptPattern)) {
      const digest = createHash('sha256')
        .update(match[1], 'utf8')
        .digest('base64');
      hashes.add(`'sha256-${digest}'`);
    }
  }

  return [...hashes].sort();
}

export function buildContentSecurityPolicy(root = repositoryRoot) {
  const scriptHashes = collectInlineScriptHashes(root);
  if (scriptHashes.length === 0) {
    throw new Error('Expected at least one audited inline page script.');
  }

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    `script-src 'self' ${scriptHashes.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
    "form-action 'self'",
    'upgrade-insecure-requests'
  ].join('; ');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(buildContentSecurityPolicy());
}
