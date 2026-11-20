// 02-07-05: real Staging-only migration adapter for the two reviewed PR SQL
// proposals. This module has NO entrypoint, startup I/O or credentials.
// A trusted, OWNER-admitted main-only workflow must provide the scoped client.
// Never run from an untrusted PR checkout or on Production.
import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import pg from 'pg';
import { verifyStagingMigrationTarget } from '../../scripts/verify-staging-migration-target.mjs';

const REPO = 'bingohooah888-ai/novelrise';
const STAGING = 'wmlzjgvxgoyrovdhbqbg';
const URL = 'https://' + STAGING + '.supabase.co';
const SHA = /^[a-f0-9]{40}$/u;
const REQUIRED = Object.freeze([
  {
    kind: 'review',
    version: '20261116220100',
    name: 'novelight_ai_owner_review_state_staging',
    path: 'reports/sql/novelight_ai_owner_review_state_PROPOSAL.sql'
  },
  {
    kind: 'claim',
    version: '20261116220101',
    name: 'novelight_ai_chunk_claim_once_staging',
    path: 'reports/sql/novelight_ai_checkpoint_claim_once_v1_PROPOSAL.sql'
  }
]);

function deny() {
  throw new Error('AI_020705_STAGING_MIGRATION_DENIED');
}

function versionList(names) {
  if (!Array.isArray(names)) deny();
  const versions = names.map((name) => {
    if (typeof name !== 'string' || !/^20\d{12}$/u.test(name)) deny();
    return name;
  });
  if (new Set(versions).size !== versions.length) deny();
  return versions.sort();
}

export function unwrap020705StagingProposal(source) {
  if (typeof source !== 'string' ||
      source.length < 100 || source.length > 40000 ||
      !/^\s*(?:--[^\n]*\n)*begin;\s*/iu.test(source) ||
      !/\scommit;\s*$/iu.test(source) ||
      source.includes('\\') ||
      /\b(?:drop\s+(?:schema|table|function)|truncate|alter\s+role|copy\s|create\s+extension)\b/iu.test(source)) {
    deny();
  }
  const start = source.indexOf('begin;');
  const end = source.lastIndexOf('commit;');
  if (start < 0 || end <= start + 6) deny();
  return source.slice(start + 6, end);
}

export function create020705StagingMigrationAdapter({
  scope,
  connectionString,
  githubToken,
  clientFactory = () => new pg.Client({
    connectionString,
    ssl: { rejectUnauthorized: true },
    application_name: 'novelight_ai_020705_owner_staging'
  }),
  fetchImpl = globalThis.fetch,
  mainMigrationFiles = () => readdirSync('supabase/migrations')
} = {}) {
  if (scope?.repository !== REPO ||
      scope?.stagingProjectRef !== STAGING ||
      scope?.supabaseUrl !== URL ||
      scope?.prNumber !== 2895 ||
      !SHA.test(scope?.mainSha ?? '') ||
      !SHA.test(scope?.candidateSha ?? '') ||
      scope.mainSha === scope.candidateSha ||
      scope?.maxMigrations !== 2 ||
      typeof connectionString !== 'string' ||
      typeof githubToken !== 'string' || githubToken.length < 10 ||
      typeof fetchImpl !== 'function' ||
      typeof clientFactory !== 'function' ||
      typeof mainMigrationFiles !== 'function') deny();

  try {
    verifyStagingMigrationTarget({
      STAGING_SUPABASE_URL: URL,
      STAGING_DATABASE_URL: connectionString,
      PGSSLMODE: 'require'
    });
  } catch {
    deny();
  }

  let completed = 0;
  let attempted = false;

  async function pinnedSql(entry) {
    const uri = 'https://api.github.com/repos/' + REPO +
      '/contents/' + entry.path + '?ref=' + scope.candidateSha;
    let file;
    try {
      const response = await fetchImpl(uri, {
        headers: {
          Authorization: 'Bearer ' + githubToken,
          Accept: 'application/vnd.github+json'
        },
        redirect: 'error',
        signal: AbortSignal.timeout(10000)
      });
      if (response.status !== 200) deny();
      file = await response.json();
    } catch {
      deny();
    }
    if (file?.path !== entry.path || file.encoding !== 'base64' ||
        !SHA.test(file.sha ?? '') ||
        typeof file.content !== 'string') deny();
    const decoded = Buffer.from(file.content.replace(/\s/gu, ''), 'base64');
    const hash = createHash('sha1')
      .update('blob ' + decoded.length + '\0')
      .update(decoded).digest('hex');
    if (hash !== file.sha) deny();
    return unwrap020705StagingProposal(decoded.toString('utf8'));
  }

  async function apply(index) {
    if (attempted || index !== completed || index > 1) deny();
    attempted = true;
    const entry = REQUIRED[index];
    let client;
    let inTransaction = false;
    try {
      const sql = await pinnedSql(entry);
      const local = mainMigrationFiles()
        .map((name) => typeof name === 'string'
          ? name.match(/^(20\d{12})_[a-z0-9_]+\.sql$/u)?.[1] : undefined)
        .filter(Boolean);
      const expected = versionList(local.concat(
        REQUIRED.slice(0, index).map((m) => m.version)
      ));
      client = clientFactory();
      await client.connect();
      const context = await client.query(
        "select current_database() as database_name, current_user as db_role"
      );
      if (context.rows?.length !== 1 ||
          context.rows[0].database_name !== 'postgres' ||
          context.rows[0].db_role !== 'postgres') deny();
      const history = await client.query(
        'select version from supabase_migrations.schema_migrations order by version'
      );
      const actual = versionList((history.rows ?? []).map((row) => row.version));
      if (JSON.stringify(actual) !== JSON.stringify(expected)) deny();
      await client.query('BEGIN');
      inTransaction = true;
      await client.query("SET LOCAL statement_timeout = '90s'");
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query("SET LOCAL idle_in_transaction_session_timeout = '120s'");
      // A proposal cannot commit independently. The Postgres migration
      // version is recorded in the SAME transaction as the reviewed DDL.
      const already = await client.query(
        'select 1 from supabase_migrations.schema_migrations where version=$1',
        [entry.version]
      );
      if (already.rows?.length) deny();
      await client.query(sql);
      await client.query(
        'insert into supabase_migrations.schema_migrations(version,name) values($1,$2)',
        [entry.version, entry.name]
      );
      await client.query('COMMIT');
      inTransaction = false;
      completed += 1;
      attempted = false;
      return true;
    } catch {
      deny();
    } finally {
      if (inTransaction && client) {
        try { await client.query('ROLLBACK'); } catch { /* fail closed */ }
      }
      if (client) {
        try { await client.end(); } catch { /* fail closed */ }
      }
    }
  }

  async function inspectInstalled() {
    let client;
    try {
      const versions = versionList(mainMigrationFiles()
        .map((name) => typeof name === 'string'
          ? name.match(/^(20\d{12})_[a-z0-9_]+\.sql$/u)?.[1]
          : undefined)
        .filter(Boolean)
        .concat(REQUIRED.map((m) => m.version)));
      client = clientFactory();
      await client.connect();
      const context = await client.query(
        'select current_database() as database_name, current_user as db_role'
      );
      if (context.rows?.[0]?.database_name !== 'postgres' ||
          context.rows?.[0]?.db_role !== 'postgres') deny();
      const history = await client.query(
        'select version from supabase_migrations.schema_migrations order by version'
      );
      if (JSON.stringify(versionList(history.rows.map((r) => r.version))) !==
          JSON.stringify(versions)) deny();
      const catalog = await client.query(
        "select to_regclass('public.novelight_ai_owner_review_states') is not null as review_table, " +
        "to_regprocedure('public.novelight_ai_owner_review_state_cas(uuid,bigint,uuid,integer,jsonb)') is not null as review_rpc, " +
        "to_regprocedure('public.novelight_ai_owner_session_exists_v1(uuid,uuid)') is not null as session_rpc, " +
        "to_regclass('public.novelight_ai_chunk_claims') is not null as claim_table, " +
        "to_regprocedure('public.novelight_ai_checkpoint_claim_once_v1(uuid,bigint,bigint,text,text,text,integer,text)') is not null as claim_rpc"
      );
      const row = catalog.rows?.[0];
      if (!row || Object.values(row).some((value) => value !== true)) deny();
      return true;
    } catch { deny(); }
    finally {
      if (client) { try { await client.end(); } catch { /* fail closed */ } }
    }
  }

  return Object.freeze({
    installReviewState: () => apply(0),
    installChunkClaim: () => apply(1),
    inspectInstalled
  });
}
