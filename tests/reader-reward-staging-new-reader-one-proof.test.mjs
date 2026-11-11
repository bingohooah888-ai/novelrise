import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildNewReaderSql,
  buildReadbackSql,
  validateOneReaderApproval
} from '../scripts/scout-formal-new-reader-staging-proof.mjs';

const head = 'a'.repeat(40);
const uuid = '11111111-1111-4111-8111-111111111111';
const prefix = 'NOVELIGHT_STAGING_NEW_READER_ONE_APPROVE ';
const fields = {
  confirmation: 'STAGING APPROVED',
  mainSha: head,
  maxReaders: 1,
  pr: 2762,
  referenceAt: '2026-11-10T00:00:00.000Z',
  scope: 'formal-new-reader-one-staging-proof',
  stagingRef: 'wmlzjgvxgoyrovdhbqbg'
};
const valid = () => {
  const body = prefix + JSON.stringify(fields);
  const event = {
    action: 'created',
    repository: { full_name: 'bingohooah888-ai/novelrise' },
    issue: {
      number: 294,
      state: 'open',
      title: '[Staging Control] Supabase migration sync'
    },
    comment: {
      id: 925,
      body,
      author_association: 'OWNER',
      user: { login: 'bingohooah888-ai' }
    },
    sender: { login: 'bingohooah888-ai' }
  };
  return {
    event,
    main: { object: { sha: head } },
    ledger: [[{ id: 925, body }]],
    env: {
      GITHUB_ACTOR: 'bingohooah888-ai',
      GITHUB_TRIGGERING_ACTOR: 'bingohooah888-ai',
      GITHUB_EVENT_NAME: 'issue_comment'
    }
  };
};
const denied = (f) =>
  assert.throws(f, /FORMAL_NEW_READER_STAGING_PROOF_DENIED/);

test('dedicated OWNER one-use approval pins correct main and one reader', () => {
  const result = validateOneReaderApproval(valid());
  assert.equal(result.mainSha, head);
  assert.equal(result.requestCommentId, '925');
  assert.equal(result.maxReaders, 1);
  assert.equal(result.referenceAt, '2026-11-10T00:00:00.000Z');
});
test('foreign owner, SHA, project, release date, and >1 readers are denied', () => {
  const variants = [
    (v) => {
      v.event.comment.user.login = 'outsider';
    },
    (v) => {
      v.env.GITHUB_ACTOR = 'outsider';
    },
    (v) => {
      v.main.object.sha = 'b'.repeat(40);
    },
    (v) => {
      v.event.issue.number = 188;
    },
    (v) => {
      v.event.comment.author_association = 'MEMBER';
    },
    (v) => {
      v.event.comment.body =
        prefix + JSON.stringify({ ...fields, maxReaders: 2 });
      v.ledger[0][0].body = v.event.comment.body;
    },
    (v) => {
      v.event.comment.body =
        prefix +
        JSON.stringify({ ...fields, referenceAt: '2027-01-01T00:00:00.000Z' });
      v.ledger[0][0].body = v.event.comment.body;
    },
    (v) => {
      v.event.comment.body =
        prefix +
        JSON.stringify({ ...fields, stagingRef: 'fiepaguycecrredwrcwx' });
      v.ledger[0][0].body = v.event.comment.body;
    }
  ];
  for (const mutate of variants) {
    const req = valid();
    mutate(req);
    denied(() => validateOneReaderApproval(req));
  }
});
test('claim/consume/edited event comment cannot authorize another run', () => {
  for (const p of [
    'NOVELIGHT_STAGING_NEW_READER_ONE_CLAIMED ',
    'NOVELIGHT_STAGING_NEW_READER_ONE_CONSUMED '
  ]) {
    const v = valid();
    v.ledger.push([{ body: p + JSON.stringify({ requestCommentId: '925' }) }]);
    denied(() => validateOneReaderApproval(v));
  }
  const changed = valid();
  changed.ledger[0][0].body = 'edited';
  denied(() => validateOneReaderApproval(changed));
});
test('exact bounded SQL touches only one new UUID and only two formal INSERTs', () => {
  const sql = buildNewReaderSql(uuid);
  assert.match(sql, /^BEGIN;/);
  assert.match(sql, /SET TRANSACTION ISOLATION LEVEL SERIALIZABLE/);
  assert.match(sql, /auth\.users.*FOR UPDATE/);
  assert.match(sql, /2026-11-10T00:00:00\.000Z/);
  assert.equal(
    (sql.match(/INSERT INTO novelight_formal_private\./g) || []).length,
    2
  );
  assert.match(
    sql,
    /VALUES \('11111111-1111-4111-8111-111111111111'::uuid,1,1,0,created,0\)/
  );
  assert.match(
    sql,
    /VALUES \('11111111-1111-4111-8111-111111111111'::uuid,0,0,0,0,0\)/
  );
  assert.doesNotMatch(
    sql,
    /(?:^\s*UPDATE\s|DELETE FROM|TRUNCATE|DROP TABLE|CREATE TRIGGER)/im
  );
  assert.match(sql, /COMMIT;$/);
  assert.match(sql, /scout_point_ledger/);
  assert.match(sql, /scout_xp_ledger/);
  denied(() =>
    buildNewReaderSql(uuid + "'; DROP TABLE public.scout_point_ledger")
  );
  denied(() => buildNewReaderSql('not a uuid'));
});
test('readback verifies Level, wallet, owner anchor, and no earned XP or Point', () => {
  const sql = buildReadbackSql(uuid);
  assert.match(sql, /'anchorOk'/);
  assert.match(sql, /'wallets'/);
  assert.match(sql, /'points'/);
  assert.match(sql, /'xp'/);
  assert.doesNotMatch(sql, /(?:INSERT|UPDATE|DELETE|DROP)/i);
});
test('existing Point 10x workflow conditions and independent job gates are intact', () => {
  const yaml = readFileSync(
    new URL(
      '../.github/workflows/staging-reader-point-tenfold-proof.yml',
      import.meta.url
    ),
    'utf8'
  );
  assert.match(
    yaml,
    /startsWith\(github\.event\.comment\.body, 'NOVELIGHT_STAGING_READER_POINT10X_APPROVE '\)/
  );
  assert.match(
    yaml,
    /startsWith\(github\.event\.comment\.body, 'NOVELIGHT_STAGING_NEW_READER_ONE_APPROVE '\)/
  );
  assert.match(yaml, /^  admit_new_reader:/m);
  assert.match(yaml, /^  stage_new_reader:/m);
  assert.match(yaml, /^  record_new_reader:/m);
  assert.match(yaml, /environment: staging/);
  assert.match(yaml, /scripts\/resolve-staging-session-pooler\.mjs/);
  assert.match(yaml, /scripts\/scout-formal-new-reader-staging-proof\.mjs run/);
  const one = yaml.slice(yaml.indexOf('\n  admit_new_reader:'));
  assert.doesNotMatch(
    one,
    /previewUrl|vercel\.app|scripts\/scout-point10x-staging-admission\.mjs/
  );
  assert.doesNotMatch(one, /workflow_dispatch:|^\s+pull_request:/m);
  assert.equal(
    (
      one.match(
        /^\s{2}(?:admit_new_reader|stage_new_reader|record_new_reader):/gm
      ) || []
    ).length,
    3
  );
});

test('main-existing migration-sync workflow keeps its original admission and reusable jobs', () => {
  const workflow = readFileSync(
    new URL(
      '../.github/workflows/supabase-staging-sync-request.yml',
      import.meta.url
    ),
    'utf8'
  );
  const [original, separate] = workflow.split(
    '\n  # Separate OWNER-only proof for one new synthetic Staging reader.'
  );
  assert.ok(separate);
  assert.ok(
    original.includes('NOVELIGHT_STAGING_APPROVE {"scope":"migration-sync",')
  );
  assert.match(original, /^  request:/m);
  assert.match(original, /^  sync:/m);
  assert.match(original, /^  record:/m);
  assert.match(
    original,
    /uses: \.\/\.github\/workflows\/supabase-staging-sync.yml/
  );
  assert.doesNotMatch(original, /ONE_READER_ONE_APPROVE/);
  assert.match(separate, /^  admit_one_new_reader:/m);
  assert.match(separate, /^  stage_one_new_reader:/m);
  assert.match(separate, /^  record_one_new_reader:/m);
  assert.doesNotMatch(separate, /NOVELIGHT_STAGING_READER_POINT10X_APPROVE/);
});

test('one-reader main job has a unique approval, fail-closed identity and scope gates', () => {
  const workflow = readFileSync(
    new URL(
      '../.github/workflows/supabase-staging-sync-request.yml',
      import.meta.url
    ),
    'utf8'
  );
  const section = workflow.slice(workflow.indexOf('\n  admit_one_new_reader:'));
  assert.match(
    section,
    /startsWith\(github\.event\.comment\.body, 'NOVELIGHT_STAGING_NEW_READER_ONE_APPROVE '\)/
  );
  assert.match(section, /v\.maxReaders!==1/);
  assert.match(section, /v\.pr!==2762/);
  assert.match(section, /v\.mainSha!==main\.object\?\.sha/);
  assert.match(section, /NOVELIGHT_STAGING_NEW_READER_ONE_CLAIMED/);
  assert.match(section, /NOVELIGHT_STAGING_NEW_READER_ONE_CONSUMED/);
  assert.match(section, /GITHUB_RUN_ATTEMPT.*1/);
  assert.match(section, /environment: staging/);
});

test('inline proof code has only synthetic Auth createUser, one JWT proof and two new-row INSERTs', () => {
  const workflow = readFileSync(
    new URL(
      '../.github/workflows/supabase-staging-sync-request.yml',
      import.meta.url
    ),
    'utf8'
  );
  const section = workflow.slice(workflow.indexOf('\n  admit_one_new_reader:'));
  assert.match(section, /auth\.admin\.createUser/);
  assert.match(section, /auth\.signInWithPassword/);
  assert.match(section, /auth\.getUser/);
  assert.match(section, /SET TRANSACTION ISOLATION LEVEL SERIALIZABLE/);
  assert.match(section, /raw_user_meta_data/);
  assert.equal(
    (section.match(/INSERT INTO novelight_formal_private\./g) || []).length,
    2
  );
  assert.match(
    section,
    /INSERT INTO novelight_formal_private\.scout_level_state/
  );
  assert.match(
    section,
    /INSERT INTO novelight_formal_private\.scout_point_usage_wallets/
  );
  assert.doesNotMatch(
    section,
    /(?:^\s*UPDATE\s|DELETE FROM|TRUNCATE|DROP TABLE|CREATE TRIGGER|vercel deploy|vercel\.app)/im
  );
  assert.doesNotMatch(
    section,
    /scripts\/scout-formal-new-reader-staging-proof\.mjs/
  );
  assert.doesNotMatch(section, /ref: (?:feature\/|pull\/)/);
});

test('both embedded GitHub Actions JavaScript snippets pass node --check without execution', async () => {
  const { spawnSync } = await import('node:child_process');
  const workflow = readFileSync(
    new URL(
      '../.github/workflows/supabase-staging-sync-request.yml',
      import.meta.url
    ),
    'utf8'
  );
  const matches = [
    ...workflow.matchAll(
      /^ {10}node --input-type=module <<'JS'[^\n]*\r?\n([\s\S]*?)^ {10}JS\r?$/gm
    )
  ];
  assert.equal(matches.length, 2);
  for (const match of matches) {
    const code = match[1]
      .split(/\r?\n/)
      .map((line) => (line.startsWith('          ') ? line.slice(10) : line))
      .join('\n');
    const r = spawnSync(process.execPath, ['--input-type=module', '--check'], {
      input: code,
      encoding: 'utf8'
    });
    assert.equal(r.status, 0, r.stderr);
  }
});

test('new-reader workflow does not expose Staging secrets to npm, checkout or whole job', () => {
  const workflow = readFileSync(
    new URL(
      '../.github/workflows/supabase-staging-sync-request.yml',
      import.meta.url
    ),
    'utf8'
  );
  const reader = workflow.slice(
    workflow.indexOf('\n  stage_one_new_reader:'),
    workflow.indexOf('\n  record_one_new_reader:')
  );
  const jobEnv = reader.slice(
    reader.indexOf('\n    env:'),
    reader.indexOf('\n    steps:')
  );
  assert.doesNotMatch(
    jobEnv,
    /STAGING_SUPABASE_SECRET_KEY:|STAGING_SUPABASE_PUBLISHABLE_KEY:|STAGING_DATABASE_URL_SOURCE:/
  );
  assert.match(
    reader,
    /STAGING_DATABASE_URL_SOURCE: \${{ secrets\.STAGING_DATABASE_URL }}/
  );
  assert.match(
    reader,
    /STAGING_SUPABASE_SECRET_KEY: \${{ secrets\.STAGING_SUPABASE_SECRET_KEY }}/
  );
  assert.match(
    reader,
    /STAGING_SUPABASE_PUBLISHABLE_KEY: \${{ secrets\.STAGING_SUPABASE_PUBLISHABLE_KEY }}/
  );
  assert.match(reader, /marker IS DISTINCT FROM/);
  assert.match(reader, /setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38/);
  assert.doesNotMatch(reader, /uses: \S+@(?:main|feature)/);
});
