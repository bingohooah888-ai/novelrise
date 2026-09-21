import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  BULK_IMPORT_LIMITS,
  duplicateWarnings,
  parseBulkEpisodes,
  parseHeading,
  validateBulkEpisodes
} from '../bulk-import-parser.js';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const migration = read(
  'supabase/migrations/20260921120552_bulk_episode_import.sql'
);
const precheck = read(
  'supabase/checks/20260921120552_bulk_episode_import_precheck.sql'
);
const postcheck = read(
  'supabase/checks/20260921120552_bulk_episode_import_postcheck.sql'
);
const rollback = read(
  'supabase/rollback/20260921120552_bulk_episode_import_rollback.sql'
);
const page = read('bulk-import.html');

test('parser recognizes Japanese episode and chapter headings', () => {
  assert.deepEqual(parseHeading('第1話　はじまり'), {
    sourceNumber: 1,
    title: 'はじまり'
  });
  assert.deepEqual(parseHeading('第１話「朝」'), {
    sourceNumber: 1,
    title: '「朝」'
  });
  assert.deepEqual(parseHeading('第一章　森へ'), {
    sourceNumber: 1,
    title: '森へ'
  });
  assert.deepEqual(parseHeading('1話 タイトル'), {
    sourceNumber: 1,
    title: 'タイトル'
  });
});

test('parser recognizes Episode Chapter and EP headings', () => {
  assert.equal(parseHeading('Episode 12 Night').sourceNumber, 12);
  assert.equal(parseHeading('Chapter 3 - Road').sourceNumber, 3);
  assert.equal(parseHeading('EP.4 Dawn').sourceNumber, 4);
});

test('automatic split preserves body newlines and blank lines', () => {
  const parsed = parseBulkEpisodes(
    '第1話 はじまり\n一行目\n\n三行目\n第2話 次\n本文'
  );
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].content, '一行目\n\n三行目');
  assert.equal(parsed[1].content, '本文');
});

test('title-less headings remain valid draft input', () => {
  const parsed = parseBulkEpisodes('第1話\n本文');
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].title, '');
  assert.deepEqual(validateBulkEpisodes(parsed), []);
});

test('custom delimiter splits author-provided text', () => {
  const parsed = parseBulkEpisodes('一話目\n本文A\n---\n二話目\n本文B', {
    delimiter: '---'
  });
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].title, '一話目');
  assert.equal(parsed[0].content, '本文A');
  assert.equal(parsed[1].title, '二話目');
});

test('100 episodes pass and 101 episodes fail', () => {
  const make = (count) =>
    Array.from({ length: count }, (_, index) => ({
      title: 't' + index,
      content: 'body',
      included: true
    }));
  assert.deepEqual(validateBulkEpisodes(make(100)), []);
  assert.match(validateBulkEpisodes(make(101))[0], /100話まで/);
});

test('empty or overlong bodies fail before registration', () => {
  assert.match(
    validateBulkEpisodes([{ title: '', content: '', included: true }])[0],
    /本文が空/
  );
  assert.match(
    validateBulkEpisodes([
      { title: '', content: 'a'.repeat(100001), included: true }
    ])[0],
    /100,000文字/
  );
});

test('duplicate warnings cover current batch and existing episodes', () => {
  const items = [
    { title: '同じ', content: '本文', included: true },
    { title: '同じ', content: '本文', included: true }
  ];
  const warnings = duplicateWarnings(items, [
    { title: '同じ', content: '本文' }
  ]);
  assert.ok(warnings.some((value) => value.includes('今回の移行内')));
  assert.ok(warnings.some((value) => value.includes('既存エピソード')));
});

test(
  'browser contract limits TXT to UTF-8 5MB and keeps safe text editing',
  () => {
    assert.equal(BULK_IMPORT_LIMITS.maxFileBytes, 5 * 1024 * 1024);
    assert.match(page, /TextDecoder\('utf-8', \{ fatal: true \}\)/);
    assert.match(page, /TXTファイルのみ選択できます/);
    assert.match(page, /textContent/);
    assert.doesNotMatch(page, /\.innerHTML\s*=/);
  }
);

test(
  'migration locks the novel and assigns contiguous numbers after current max',
  () => {
    assert.match(migration, /for update/);
    assert.match(migration, /coalesce\(max\(e\.episode_number\), 0\) \+ 1/);
    assert.match(migration, /v_start_number \+ item\.ordinality - 1/);
    assert.match(migration, /between 1 and 100 episodes/);
    assert.match(migration, /Unexpected import item field/);
    assert.match(migration, /'draft'/);
  }
);

test('migration and analytics surfaces stay authenticated-only', () => {
  assert.match(
    migration,
    /alter table public\.bulk_import_events enable row level security/
  );
  assert.match(
    migration,
    /revoke all on table public\.bulk_import_events from authenticated/
  );
  assert.match(
    migration,
    /revoke all on function public\.novelight_bulk_import_episode_drafts\(bigint,jsonb\) from anon/
  );
  assert.match(
    migration,
    /grant execute on function public\.novelight_bulk_import_episode_drafts\(bigint,jsonb\) to authenticated/
  );
  assert.match(migration, /security definer/);
  assert.match(migration, /n\.user_id = v_user_id/);
});

test('precheck postcheck and rollback preserve the old import path', () => {
  assert.match(precheck, /Existing beta import RPC is missing/);
  assert.match(postcheck, /Existing beta import RPC must remain available/);
  assert.match(postcheck, /Raw bulk import analytics table must stay closed/);
  assert.match(
    rollback,
    /bulk_import_events contains data; preserve it before rollback/
  );
  assert.match(rollback, /Existing beta import RPC was unexpectedly removed/);
});


test('temporary prettier probe', async () => {
  const prettier = await import('prettier');
  const source = "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { readFileSync } from 'node:fs';\nimport { resolve } from 'node:path';\nimport {\n  BULK_IMPORT_LIMITS,\n  duplicateWarnings,\n  parseBulkEpisodes,\n  parseHeading,\n  validateBulkEpisodes\n} from '../bulk-import-parser.js';\n\nconst root = process.cwd();\nconst read = (path) => readFileSync(resolve(root, path), 'utf8');\nconst migration = read(\n  'supabase/migrations/20260921120552_bulk_episode_import.sql'\n);\nconst precheck = read(\n  'supabase/checks/20260921120552_bulk_episode_import_precheck.sql'\n);\nconst postcheck = read(\n  'supabase/checks/20260921120552_bulk_episode_import_postcheck.sql'\n);\nconst rollback = read(\n  'supabase/rollback/20260921120552_bulk_episode_import_rollback.sql'\n);\nconst page = read('bulk-import.html');\n\ntest('parser recognizes Japanese episode and chapter headings', () => {\n  assert.deepEqual(parseHeading('第1話　はじまり'), {\n    sourceNumber: 1,\n    title: 'はじまり'\n  });\n  assert.deepEqual(parseHeading('第１話「朝」'), {\n    sourceNumber: 1,\n    title: '「朝」'\n  });\n  assert.deepEqual(parseHeading('第一章　森へ'), {\n    sourceNumber: 1,\n    title: '森へ'\n  });\n  assert.deepEqual(parseHeading('1話 タイトル'), {\n    sourceNumber: 1,\n    title: 'タイトル'\n  });\n});\n\ntest('parser recognizes Episode Chapter and EP headings', () => {\n  assert.equal(parseHeading('Episode 12 Night').sourceNumber, 12);\n  assert.equal(parseHeading('Chapter 3 - Road').sourceNumber, 3);\n  assert.equal(parseHeading('EP.4 Dawn').sourceNumber, 4);\n});\n\ntest('automatic split preserves body newlines and blank lines', () => {\n  const parsed = parseBulkEpisodes(\n    '第1話 はじまり\\n一行目\\n\\n三行目\\n第2話 次\\n本文'\n  );\n  assert.equal(parsed.length, 2);\n  assert.equal(parsed[0].content, '一行目\\n\\n三行目');\n  assert.equal(parsed[1].content, '本文');\n});\n\ntest('title-less headings remain valid draft input', () => {\n  const parsed = parseBulkEpisodes('第1話\\n本文');\n  assert.equal(parsed.length, 1);\n  assert.equal(parsed[0].title, '');\n  assert.deepEqual(validateBulkEpisodes(parsed), []);\n});\n\ntest('custom delimiter splits author-provided text', () => {\n  const parsed = parseBulkEpisodes('一話目\\n本文A\\n---\\n二話目\\n本文B', {\n    delimiter: '---'\n  });\n  assert.equal(parsed.length, 2);\n  assert.equal(parsed[0].title, '一話目');\n  assert.equal(parsed[0].content, '本文A');\n  assert.equal(parsed[1].title, '二話目');\n});\n\ntest('100 episodes pass and 101 episodes fail', () => {\n  const make = (count) =>\n    Array.from({ length: count }, (_, index) => ({\n      title: 't' + index,\n      content: 'body',\n      included: true\n    }));\n  assert.deepEqual(validateBulkEpisodes(make(100)), []);\n  assert.match(validateBulkEpisodes(make(101))[0], /100話まで/);\n});\n\ntest('empty or overlong bodies fail before registration', () => {\n  assert.match(\n    validateBulkEpisodes([{ title: '', content: '', included: true }])[0],\n    /本文が空/\n  );\n  assert.match(\n    validateBulkEpisodes([\n      { title: '', content: 'a'.repeat(100001), included: true }\n    ])[0],\n    /100,000文字/\n  );\n});\n\ntest('duplicate warnings cover current batch and existing episodes', () => {\n  const items = [\n    { title: '同じ', content: '本文', included: true },\n    { title: '同じ', content: '本文', included: true }\n  ];\n  const warnings = duplicateWarnings(items, [\n    { title: '同じ', content: '本文' }\n  ]);\n  assert.ok(warnings.some((value) => value.includes('今回の移行内')));\n  assert.ok(warnings.some((value) => value.includes('既存エピソード')));\n});\n\ntest(\n  'browser contract limits TXT to UTF-8 5MB and keeps safe text editing',\n  () => {\n    assert.equal(BULK_IMPORT_LIMITS.maxFileBytes, 5 * 1024 * 1024);\n    assert.match(page, /TextDecoder\\('utf-8', \\{ fatal: true \\}\\)/);\n    assert.match(page, /TXTファイルのみ選択できます/);\n    assert.match(page, /textContent/);\n    assert.doesNotMatch(page, /\\.innerHTML\\s*=/);\n  }\n);\n\ntest(\n  'migration locks the novel and assigns contiguous numbers after current max',\n  () => {\n    assert.match(migration, /for update/);\n    assert.match(migration, /coalesce\\(max\\(e\\.episode_number\\), 0\\) \\+ 1/);\n    assert.match(migration, /v_start_number \\+ item\\.ordinality - 1/);\n    assert.match(migration, /between 1 and 100 episodes/);\n    assert.match(migration, /Unexpected import item field/);\n    assert.match(migration, /'draft'/);\n  }\n);\n\ntest('migration and analytics surfaces stay authenticated-only', () => {\n  assert.match(\n    migration,\n    /alter table public\\.bulk_import_events enable row level security/\n  );\n  assert.match(\n    migration,\n    /revoke all on table public\\.bulk_import_events from authenticated/\n  );\n  assert.match(\n    migration,\n    /revoke all on function public\\.novelight_bulk_import_episode_drafts\\(bigint,jsonb\\) from anon/\n  );\n  assert.match(\n    migration,\n    /grant execute on function public\\.novelight_bulk_import_episode_drafts\\(bigint,jsonb\\) to authenticated/\n  );\n  assert.match(migration, /security definer/);\n  assert.match(migration, /n\\.user_id = v_user_id/);\n});\n\ntest('precheck postcheck and rollback preserve the old import path', () => {\n  assert.match(precheck, /Existing beta import RPC is missing/);\n  assert.match(postcheck, /Existing beta import RPC must remain available/);\n  assert.match(postcheck, /Raw bulk import analytics table must stay closed/);\n  assert.match(\n    rollback,\n    /bulk_import_events contains data; preserve it before rollback/\n  );\n  assert.match(rollback, /Existing beta import RPC was unexpectedly removed/);\n});\n";
  const config =
    (await prettier.resolveConfig('tests/bulk-episode-import.test.mjs')) || {};
  const formatted = await prettier.format(source, {
    ...config,
    filepath: 'tests/bulk-episode-import.test.mjs'
  });
  console.log(
    'NOVELIGHT_PRETTIER_PROBE=' + Buffer.from(formatted).toString('base64')
  );
});
