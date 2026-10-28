// Offline read-only migration parity gate. No Supabase client, network access,
// service key, migrations, or schema mutations. Feed exported version lists.
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const VERSION = /^\d{14}$/;
const FILE = /^(\d{14})_[a-z0-9_]+\.sql$/;

function versions(input) {
  if (!Array.isArray(input)) throw new Error('INVALID_MIGRATION_LEDGER');
  const seen = new Set();
  for (const item of input) {
    const value = typeof item === 'string' ? item : item?.version;
    if (typeof value !== 'string' || !VERSION.test(value) || seen.has(value)) {
      throw new Error('INVALID_MIGRATION_LEDGER');
    }
    seen.add(value);
  }
  return [...seen].sort();
}

function difference(expected, actual) {
  const current = new Set(actual);
  const required = new Set(expected);
  return {
    missing: expected.filter((v) => !current.has(v)),
    extra: actual.filter((v) => !required.has(v))
  };
}

export function compareMigrationLedgers({ local, staging, production } = {}) {
  const expected = versions(local);
  const stage = versions(staging);
  const prod = versions(production);
  const stagingDrift = difference(expected, stage);
  const productionDrift = difference(expected, prod);
  return {
    ok:
      stagingDrift.missing.length === 0 &&
      stagingDrift.extra.length === 0 &&
      productionDrift.missing.length === 0 &&
      productionDrift.extra.length === 0,
    counts: {
      local: expected.length,
      staging: stage.length,
      production: prod.length
    },
    staging: stagingDrift,
    production: productionDrift
  };
}

export async function readLocalMigrationVersions(
  directory = new URL('../supabase/migrations/', import.meta.url)
) {
  const filenames = await readdir(directory);
  const found = [];
  for (const file of filenames) {
    if (!file.endsWith('.sql')) continue;
    const match = FILE.exec(file);
    if (!match) throw new Error('INVALID_MIGRATION_FILENAME');
    found.push(match[1]);
  }
  return versions(found);
}

function payload(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.migrations)) return value.migrations;
  throw new Error('INVALID_MIGRATION_LEDGER');
}

async function main() {
  const [stagingFile, productionFile] = process.argv.slice(2);
  if (!stagingFile || !productionFile || process.argv.length !== 4) {
    throw new Error(
      'Usage: node scripts/check-ai-review-migration-parity.mjs ' +
        '<staging-versions.json> <production-versions.json>'
    );
  }
  const [local, staging, production] = await Promise.all([
    readLocalMigrationVersions(),
    readFile(resolve(stagingFile), 'utf8').then((raw) =>
      payload(JSON.parse(raw))
    ),
    readFile(resolve(productionFile), 'utf8').then((raw) =>
      payload(JSON.parse(raw))
    )
  ]);
  const result = compareMigrationLedgers({ local, staging, production });
  // Versions and counts only; no connection details or credentials.
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (!result.ok) process.exitCode = 1;
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  main().catch((error) => {
    process.stderr.write(error.message + '\n');
    process.exitCode = 1;
  });
}
