// Offline compiler for ONE reviewed Staging migration; this file has no DB access.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const PREFIX = '20261029142000_exclude_internal_scout_campaign_entries';
export const FIXED_FILES = Object.freeze({
  migration: 'supabase/migrations/' + PREFIX + '.sql',
  pre: 'supabase/checks/' + PREFIX + '_precheck.sql',
  post: 'supabase/checks/' + PREFIX + '_postcheck.sql',
  rollback: 'supabase/rollback/' + PREFIX + '_rollback.sql'
});
export const EXPECTED_BLOBS = Object.freeze({
  migration: 'd887dc40233ef727bd74f8a6c92ea5ea252ea957',
  pre: '601f7a5e11d76f06921e845fe460a6f455971b54',
  post: '0b54e2538761cda7a07e32908d71b200464eee97',
  rollback: 'fa00bc61da615462fa3640d16f13eebe700e2359'
});
function deny() { throw new Error('CAMPAIGN_STAGING_TRANSACTION_DENIED'); }
function blobSha(s) {
  const bytes = Buffer.from(s, 'utf8');
  return createHash('sha1').update('blob ' + bytes.length + '\0')
    .update(bytes).digest('hex');
}
export function compileCampaignStagingTransaction(parts) {
  for (const key of Object.keys(FIXED_FILES)) {
    if (typeof parts?.[key] !== 'string' ||
        blobSha(parts[key]) !== EXPECTED_BLOBS[key] ||
        parts[key].includes('\\')) deny();
  }
  const migration = parts.migration.replaceAll('\r\n', '\n');
  const lines = migration.split('\n');
  const begins = lines.flatMap((l, i) => /^begin;\s*$/iu.test(l) ? [i] : []);
  const ends = lines.flatMap((l, i) => /^commit;\s*$/iu.test(l) ? [i] : []);
  if (begins.length !== 1 || ends.length !== 1 ||
      begins[0] >= ends[0] ||
      lines.slice(0, begins[0]).some((l) => l.trim() &&
        !l.trim().startsWith('--')) ||
      lines.slice(ends[0] + 1).some((l) => l.trim()) ||
      [parts.pre, parts.post].some((q) =>
        /^\s*(?:begin|commit|rollback)\s*;/imu.test(q))) deny();
  const body = lines.slice(begins[0] + 1, ends[0]).join('\n');
  return [
    '\\set ON_ERROR_STOP on',
    'BEGIN;',
    "SET LOCAL statement_timeout = '120s';",
    "SET LOCAL lock_timeout = '5s';",
    "SET LOCAL idle_in_transaction_session_timeout = '180s';",
    parts.pre,
    body,
    "INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES (" +
      "'20261029142000', 'exclude_internal_scout_campaign_entries');",
    parts.post,
    'COMMIT;',
    ''
  ].join('\n');
}
if (process.argv[1] &&
    import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const parts = Object.fromEntries(
      Object.entries(FIXED_FILES).map(([name, path]) =>
        [name, readFileSync(path, 'utf8')])
    );
    process.stdout.write(compileCampaignStagingTransaction(parts));
  } catch {
    console.error('CAMPAIGN_STAGING_TRANSACTION_DENIED');
    process.exitCode = 1;
  }
}
