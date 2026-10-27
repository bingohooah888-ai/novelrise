import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const proposalUrl = new URL(
  '../reports/sql/novelight_ai_review_candidates_PROPOSAL.sql',
  import.meta.url
);

const cases = [
  [
    'A',
    'B',
    'b64e3448a83a5b86466465080361c1a7e1157a27ddccd4b68069cb18caffb74a'
  ],
  [
    '架空の第一話',
    '凛は青い鍵を持っていた。',
    '06db088a8ad2a94626769b3072d7d4141f166a93d35707b6f93ab3b31a7add2b'
  ],
  [
    'emoji🌸',
    '改稿🦊',
    '8df4bb3a28a0edb3fc8e22586a0dd2867e243fff2b7de16a9c8ea56d8c74e005'
  ],
  [
    'A\b',
    'B\f',
    'ecdefbc2d768f171b1b4e380bad357af88a6a054b4fe8e0c355537e09f71b376'
  ],
  [
    'A\u2028',
    'B\u2029',
    '309d9a9ff4bc6d2b08ea2f1ea23596287594302c2992ed99e922aebdb3745eba'
  ],
  [
    'slash\\back',
    'line\r\n tab\t',
    '0fae91f7e193a234ac974bac7ffc29d2e22eec2694a5fbabc91ea63dbb1079f3'
  ]
];

test('Node source hashing agrees with read-only PostgreSQL fixtures', () => {
  for (const [title, body, expected] of cases) {
    const computed = createHash('sha256')
      .update(JSON.stringify([title, body]))
      .digest('hex');
    assert.equal(computed, expected);
  }
});

test('SQL proposal locks current episode on BOTH stage and decision', async () => {
  const sql = await readFile(proposalUrl, 'utf8');
  const matches = sql.match(/for share of e, n;/g) || [];
  assert.equal(matches.length, 2);
  const hashes = sql.match(/v_current_hash is distinct from p_source_hash/g);
  assert.equal(hashes?.length, 2);
  const lockBeforeStage = sql.indexOf('for share of e, n;');
  const insert = sql.indexOf(
    'insert into public.novelight_ai_review_candidates'
  );
  assert.ok(lockBeforeStage > 0 && lockBeforeStage < insert);
  const lockBeforeDecision = sql.lastIndexOf('for share of e, n;');
  const update = sql.lastIndexOf(
    'update public.novelight_ai_review_candidates'
  );
  assert.ok(lockBeforeDecision > insert && lockBeforeDecision < update);
});

test('PostgreSQL parity uses verified UTF-8 JSON and pgcrypto', async () => {
  const sql = await readFile(proposalUrl, 'utf8');
  assert.equal((sql.match(/extensions\.digest/g) || []).length, 2);
  assert.equal((sql.match(/pg_catalog\.to_json\(v_title\)/g) || []).length, 2);
  assert.equal((sql.match(/pg_catalog\.to_json\(v_body\)/g) || []).length, 2);
  assert.match(sql, /pg_catalog\.convert_to\(/);
  assert.match(sql, /'sha256'/);
  assert.match(sql, /v_title is null or v_body is null/);
  assert.match(sql, /and c\.revision = p_expected_revision/);
  assert.match(sql, /and c\.status = 'pending'/);
  assert.match(sql, /current_user <> 'service_role'/);
  assert.match(sql, /enable row level security/);
  assert.doesNotMatch(sql, /security definer/i);
});

test('SQL remains a non-migration proposal until staging approval', async () => {
  const sql = await readFile(proposalUrl, 'utf8');
  assert.match(sql, /REVIEW ONLY\. NOT a runnable migration/);
  assert.match(sql, /revoke all on public\.novelight_ai_review_candidates/);
  assert.match(sql, /revoke all on function/);
});
