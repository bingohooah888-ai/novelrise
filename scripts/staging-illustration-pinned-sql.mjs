// Trusted-main exception for ONE reviewed PNG illustration migration.
// It never connects to a DB, executes candidate code, or loosens generic admission.
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gitBlobSha } from './staging-follow-list-pinned-sql.mjs';

export const ILLUSTRATION_PINNED = Object.freeze({
  pr: 2861,
  version: '20261114121000',
  file: '20261114121000_episode_illustration_png_delivery_consistency.sql',
  blobs: Object.freeze({
    "migration": "6ec298c8796e2d3c94f8e561ebb2cf966e41ed31",
    "precheck": "6ee0f80b7dc0df8279f756965343b9b2d4aa045c",
    "postcheck": "84e2a06d4a3fe058b1112f3dfecd690e6c6509a5",
    "rollback": "84a8f89c7332d04e17bf183e7ef8735cf3dac9d0"
})
});

function deny(reason) {
  throw new Error('ILLUSTRATION_PINNED_STAGING_DENIED: ' + reason);
}

export function composePinnedIllustrationSql({
  pr, version, migrationFile, artifacts, mode
}) {
  const pin = ILLUSTRATION_PINNED;
  if (pr !== pin.pr || version !== pin.version || migrationFile !== pin.file) {
    deny('wrong PR, migration version or filename');
  }
  if (mode !== 'check' && mode !== 'persist') deny('mode must be check or persist');
  if (!artifacts || typeof artifacts !== 'object' ||
      Object.keys(artifacts).sort().join('|') !== Object.keys(pin.blobs).sort().join('|')) {
    deny('expected exactly four pinned reviewed SQL artifacts');
  }
  for (const [kind, expected] of Object.entries(pin.blobs)) {
    const value = artifacts[kind];
    if (typeof value !== 'string' || !value.length ||
        Buffer.byteLength(value, 'utf8') > 200000 ||
        value.includes('\0') || gitBlobSha(value) !== expected) {
      deny('SQL blob content drift: ' + kind);
    }
  }
  const lines = artifacts.migration.replaceAll('\r\n', '\n').split('\n');
  const start = lines.findIndex((line) => /^begin;$/iu.test(line.trim()));
  const end = lines.findIndex((line) => /^commit;$/iu.test(line.trim()));
  if (start < 0 || end <= start ||
      lines.slice(end + 1).join('').trim() ||
      lines.slice(0, start).some((line) => line.trim() && !line.trim().startsWith('--'))) {
    deny('reviewed outer migration transaction changed');
  }
  for (const kind of ['precheck', 'postcheck']) {
    const text = artifacts[kind];
    if (/^\s*(?:begin|commit|rollback)\s*;/imu.test(text) ||
        /(^|\n)\s*\\/mu.test(text)) {
      deny('pre/postcheck must stay inside trusted transaction: ' + kind);
    }
  }
  const ledger = mode === 'persist' ? [
    "INSERT INTO supabase_migrations.schema_migrations(version,name)",
    "VALUES ('20261114121000','episode_illustration_png_delivery_consistency');"
  ] : [];
  return [
    '\\set ON_ERROR_STOP on',
    'BEGIN;',
    "SET LOCAL statement_timeout='120s';",
    "SET LOCAL lock_timeout='5s';",
    "SET LOCAL idle_in_transaction_session_timeout='180s';",
    'DO $png_version_guard$ BEGIN',
    " IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version::text='20261114121000') THEN",
    "   RAISE EXCEPTION 'Illustration PNG migration already recorded';",
    " END IF;",
    'END $png_version_guard$;',
    '-- Exactly reviewed PNG precheck',
    artifacts.precheck,
    '-- Exactly reviewed migration (outer COMMIT removed)',
    lines.slice(start + 1, end).join('\n'),
    '-- Exactly reviewed PNG postcheck',
    artifacts.postcheck,
    ...ledger,
    mode === 'persist' ? 'COMMIT;' : 'ROLLBACK;',
    ''
  ].join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  try {
    if (process.argv.length !== 8 || process.argv[2] !== 'compose') {
      deny('expected compose ROOT VERSION FILENAME PR MODE');
    }
    const [, , , root, version, filename, prText, mode] = process.argv;
    if (basename(filename) !== filename || !/^[0-9]+$/u.test(prText)) {
      deny('invalid CLI PR or filename');
    }
    const artifacts = Object.fromEntries(Object.keys(ILLUSTRATION_PINNED.blobs)
      .map((kind) => [kind, readFileSync(join(root, kind + '.sql'), 'utf8')]));
    process.stdout.write(composePinnedIllustrationSql({
      pr: Number(prText), version, migrationFile: filename, artifacts, mode
    }));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
