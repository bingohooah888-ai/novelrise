// Compile precisely pinned PR SQL into ONE rollback-only psql transaction.
// This is a conservative safety filter, not a replacement for human SQL review.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MAX_SQL_BYTES = 200000;
function deny(reason) { throw new Error('STAGING_CANDIDATE_SQL_DENIED: ' + reason); }

export function unwrapCandidateSql(sql, kind) {
  if (typeof sql !== 'string' || !sql.trim() ||
      Buffer.byteLength(sql,'utf8') > MAX_SQL_BYTES || sql.includes('\0')) {
    deny('invalid SQL source');
  }
  // Block psql meta commands, including \connect, \! and \copy.
  if (/^\s*\\/mu.test(sql)) deny('psql meta-command is not permitted');
  // Explicitly reject irreversible, external, privileged, or remote effects.
  if (/\b(?:dblink|postgres_fdw|http_get|http_post|pg_notify|pg_background|pg_cron|pgmq|pg_net|pg_sleep|pg_terminate_backend|pg_cancel_backend|lo_export|lo_import|pg_read_file|pg_write_file|pg_execute_server_program)\b/iu.test(sql) ||
      /\b(?:create\s+extension|create\s+(?:database|subscription|server|foreign\s+table)|alter\s+system|copy\b[^;]*\bprogram|execute\s+program|create\s+event\s+trigger|security\s+definer)\b/iu.test(sql)) {
    deny('external or unsafe operation');
  }
  const lines=sql.replaceAll('\r\n','\n').split('\n');
  const starts=lines.map((l,i)=>/^\s*begin\s*;\s*$/iu.test(l)?i:-1).filter(x=>x>=0);
  const commits=lines.map((l,i)=>/^\s*commit\s*;\s*$/iu.test(l)?i:-1).filter(x=>x>=0);
  const rolls=lines.map((l,i)=>/^\s*rollback\s*;\s*$/iu.test(l)?i:-1).filter(x=>x>=0);
  if (kind==='migration') {
    if (starts.length!==1 || commits.length!==1 || rolls.length!==0 ||
        starts[0]>=commits[0]) deny('migration must have one outer begin/commit');
    const after=lines.slice(commits[0]+1).join('').trim();
    if (after) deny('migration contains statements after COMMIT');
    const before=lines.slice(0,starts[0]).filter(x=>!/^\s*(?:--.*)?$/u.test(x));
    if (before.length) deny('migration has pre-BEGIN statements');
    sql=lines.slice(starts[0]+1,commits[0]).join('\n');
  } else if(kind==='precheck' || kind==='postcheck') {
    if (starts.length || commits.length || rolls.length) {
      deny('checks must not open/close transactions');
    }
  } else deny('unknown SQL artifact type');
  // No explicit transaction escape inside the reviewed body. PostgreSQL DO
  // blocks use bare BEGIN without a semicolon and remain permitted.
  if (/^\s*(?:commit|rollback|savepoint|release\s+savepoint|prepare\s+transaction)\b/imu.test(sql)) {
    deny('transaction escape');
  }
  return sql;
}

export function composeCandidateRollbackSql({precheck,migration,postcheck}) {
  const pre = unwrapCandidateSql(precheck,'precheck');
  const body= unwrapCandidateSql(migration,'migration');
  const post= unwrapCandidateSql(postcheck,'postcheck');
  return [
    '\\set ON_ERROR_STOP on',
    'BEGIN;',
    "SET LOCAL statement_timeout = '120s';",
    "SET LOCAL lock_timeout = '5s';",
    "SET LOCAL idle_in_transaction_session_timeout = '180s';",
    '-- Server uses only dedicated Staging credentials.',
    pre,
    body,
    post,
    '-- Always leave Staging without candidate schema or ledger mutations.',
    'ROLLBACK;',
    ''
  ].join('\n');
}

if (process.argv[2] === 'compose') {
  try {
    if (process.argv.length !== 4) deny('exact SQL artifact directory required');
    const root=process.argv[3];
    const paths=['precheck','migration','postcheck'];
    const parts=Object.fromEntries(paths.map((kind) =>
      [kind, readFileSync(join(root,kind+'.sql'),'utf8')]));
    process.stdout.write(composeCandidateRollbackSql(parts));
  } catch(e) { console.error(e.message); process.exitCode=1; }
}
