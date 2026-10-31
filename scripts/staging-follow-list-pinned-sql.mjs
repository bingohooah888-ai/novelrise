// Trusted-main ONLY. An exact reviewed exception for PR #2698, never a
// general relaxation of scripts/staging-candidate-sql.mjs.
// This module assembles SQL but cannot connect to any database.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const FOLLOW_LIST_PINNED = Object.freeze({
  pr: 2698,
  version: '20261031173000',
  migrationFile: '20261031173000_followed_authors_list.sql',
  blobs: Object.freeze({
    migration: 'e283f08a519fb8ad1dcd65f248f283a57c918b8f',
    precheck: '080d1450c0314a0c64c770d99d93d1a0cafbbd34',
    postcheck: '83e6c855bb2c2eba2f39c37916a116a71552bd3f',
    rollback: '9bb9b72850611f81ca40f1eccb0328bcc0dcdeba'
  })
});

function deny(reason) {
  throw new Error('FOLLOW_LIST_PINNED_STAGING_DENIED: ' + reason);
}

export function gitBlobSha(content) {
  if (typeof content !== 'string') deny('SQL content must be UTF-8 text');
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1')
    .update(Buffer.from('blob ' + bytes.length + '\0'))
    .update(bytes)
    .digest('hex');
}

export function composePinnedFollowListStagingSql({
  pr, version, migrationFile, artifacts
}) {
  const pin = FOLLOW_LIST_PINNED;
  if (pr !== pin.pr || version !== pin.version ||
      migrationFile !== pin.migrationFile) {
    deny('reviewed PR number, migration version or filename drifted');
  }
  if (!artifacts || typeof artifacts !== 'object' ||
      Object.keys(artifacts).sort().join('|') !==
      Object.keys(pin.blobs).sort().join('|')) {
    deny('expected exactly four SQL artifacts');
  }
  for (const [kind, expected] of Object.entries(pin.blobs)) {
    const value = artifacts[kind];
    if (typeof value !== 'string' || !value.length ||
        Buffer.byteLength(value, 'utf8') > 200000 ||
        value.includes('\0') || gitBlobSha(value) !== expected) {
      deny('reviewed Git blob mismatch: ' + kind);
    }
  }

  // Only hash-identical reviewed SQL may reach this point.
  // Retain existing strict global SECURITY DEFINER denial for every
  // other candidate. Candidate scripts and workflow files are never loaded.
  const lines = artifacts.migration.replaceAll('\r\n', '\n').split('\n');
  const start = lines.findIndex((line) => /^begin;$/iu.test(line.trim()));
  const end = lines.findIndex((line) => /^commit;$/iu.test(line.trim()));
  if (start < 0 || end <= start ||
      lines.slice(end + 1).join('').trim() ||
      lines.slice(0, start).some((line) => line.trim() && !line.trim().startsWith('--'))) {
    deny('reviewed migration outer transaction shape changed');
  }
  const migrationBody = lines.slice(start + 1, end).join('\n');
  return [
    '\\set ON_ERROR_STOP on',
    'BEGIN;',
    "SET LOCAL statement_timeout = '120s';",
    "SET LOCAL lock_timeout = '5s';",
    "SET LOCAL idle_in_transaction_session_timeout = '180s';",
    'DO $follow_pinned_ledger$ BEGIN',
    "  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations",
    "    WHERE version = '20261031173000') THEN",
    "    RAISE EXCEPTION 'Pinned follow migration is already recorded';",
    '  END IF;',
    'END $follow_pinned_ledger$;',
    '-- Exact approved precheck Git blob',
    artifacts.precheck,
    '-- Exact approved migration Git blob, outer commit removed',
    migrationBody,
    '-- Exact approved postcheck Git blob',
    artifacts.postcheck,
    "INSERT INTO supabase_migrations.schema_migrations (version,name)",
    "VALUES ('20261031173000','followed_authors_list');",
    '-- One committed dedicated Staging transaction only after all checks',
    'COMMIT;',
    ''
  ].join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  try {
    if (process.argv.length !== 7 || process.argv[2] !== 'compose') {
      deny('expected compose ROOT VERSION FILENAME PR');
    }
    const [, , , root, version, filename, prText] = process.argv;
    if (basename(filename) !== filename || !/^[0-9]+$/u.test(prText)) {
      deny('invalid CLI filename or PR number');
    }
    const artifacts = Object.fromEntries(
      Object.keys(FOLLOW_LIST_PINNED.blobs).map((kind) => [
        kind, readFileSync(join(root, kind + '.sql'), 'utf8')
      ])
    );
    process.stdout.write(composePinnedFollowListStagingSql({
      pr: Number(prText), version, migrationFile: filename, artifacts
    }));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
