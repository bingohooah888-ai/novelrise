import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';

const draft = readFileSync(
  new URL(
    '../docs/drafts/SCOUT_FORMAL_EARNINGS_ATOMIC_DRAFT.sql',
    import.meta.url
  ),
  'utf8'
);
const runner = readFileSync(
  new URL(
    '../api/_lib/reader-reward/formal-earning-runner.js',
    import.meta.url
  ),
  'utf8'
);
const bridge = readFileSync(
  new URL(
    '../api/_lib/reader-reward/formal-admin-comment-review.js',
    import.meta.url
  ),
  'utf8'
);
const durable = readFileSync(
  new URL(
    '../api/_lib/reader-reward/formal-earning-durable.js',
    import.meta.url
  ),
  'utf8'
);

function sqlBody(tag) {
  const body = draft.match(
    new RegExp('as \\$' + tag + '\\$([\\s\\S]*?)\\$' + tag + '\\$')
  )?.[1];
  assert.ok(body, 'Draft SQL function body missing: ' + tag);
  return body;
}

test('review provenance is a private RLS-protected, one-decision-per-comment table', () => {
  assert.match(
    draft,
    /create table novelight_formal_private\.scout_comment_review_evidence/
  );
  assert.match(draft, /review_id uuid primary key/);
  assert.match(
    draft,
    /comment_id uuid not null unique references public\.novel_comments\(id\) on delete restrict/
  );
  assert.match(
    draft,
    /reviewer_user_id uuid not null references auth\.users\(id\) on delete restrict/
  );
  assert.match(
    draft,
    /body_sha256 text not null check\(body_sha256 ~ '\^\[0-9a-f\]\{64\}\$'\)/
  );
  assert.match(
    draft,
    /reviewed_at timestamptz not null default clock_timestamp\(\)/
  );
  assert.match(
    draft,
    /alter table novelight_formal_private\.scout_comment_review_evidence\s+enable row level security/
  );
  assert.match(
    draft,
    /revoke all on novelight_formal_private\.scout_comment_review_evidence\s+from public,anon,authenticated,service_role/
  );
  assert.doesNotMatch(
    draft,
    /grant (?:insert|update|delete) on novelight_formal_private\.scout_comment_review_evidence/i
  );
});

test('private decision atomically locks source and pending claim, verifies hash, then writes evidence', () => {
  const body = sqlBody('earning_review');
  assert.match(
    draft,
    /p_reviewer_user_id uuid,p_review_id uuid,p_body_sha256 text,p_episode_id bigint/
  );
  assert.match(
    body,
    /from public\.novel_comments\s+where id=p_comment_id for update/
  );
  assert.match(
    body,
    /from novelight_formal_private\.scout_earning_delivery[\s\S]*?for update/
  );
  assert.match(
    body,
    /from novelight_formal_private\.scout_comment_review_evidence/
  );
  assert.match(body, /review_conflict_requires_owner_policy/);
  assert.match(body, /v_state <> 'review_pending'/);
  assert.ok(
    body.indexOf('pg_catalog.sha256') < body.indexOf('select * into v_old'),
    'locked source freshness must be checked before replay idempotence'
  );
  assert.match(
    body,
    /pg_catalog\.sha256\(pg_catalog\.convert_to\(v_comment\.body,'UTF8'\)\)/
  );
  assert.match(body, /if p_eligible and \(v_comment\.deleted_at is not null/);
  const insert = body.indexOf(
    'insert into novelight_formal_private.scout_comment_review_evidence'
  );
  const advance = body.indexOf(
    'update novelight_formal_private.scout_earning_delivery'
  );
  assert.ok(insert >= 0 && advance > insert);
  assert.match(body, /raise exception 'FORMAL_REVIEW_ATOMIC_CONFLICT'/);
  assert.doesNotMatch(
    draft,
    /decide_earning_review_draft\(uuid,boolean,text\)\s+to service_role/
  );
});

test('all comment awarding paths demand an immutable snapshot proof', () => {
  const award = sqlBody('award_comment');
  const reviewAward = sqlBody('review_award');
  for (const body of [award, reviewAward]) {
    assert.match(
      body,
      /from public\.novel_comments\s+where id=p_comment_id for update/
    );
    assert.match(body, /scout_comment_review_evidence/);
    assert.match(body, /review_evidence_missing/);
    assert.match(body, /review_source_changed_requires_owner_policy/);
    assert.match(
      body,
      /pg_catalog\.sha256\(pg_catalog\.convert_to\(v_comment\.body,'UTF8'\)\)/
    );
  }
  assert.match(
    draft,
    /revoke all on novelight_formal_private\.scout_comment_eligibility from public,anon,authenticated,service_role/
  );
  assert.match(
    draft,
    /revoke all on novelight_formal_private\.scout_earning_delivery\s+from public,anon,authenticated,service_role/
  );
});

test('trusted admin auth is reused without creating a registered API or workflow', () => {
  assert.match(
    bridge,
    /import \{[\s\S]*?requireAdmin[\s\S]*?\} from '\.\.\/admin-auth\.js'/
  );
  assert.match(bridge, /await requireAdmin\(\{ req, res, supabase, env \}\)/);
  assert.match(bridge, /if \(!req\.headers\?\.origin\)/);
  assert.match(bridge, /reviewed_body_sha256/);
  assert.match(bridge, /const reviewId = randomUUID\(\)/);
  assert.match(
    runner,
    /createHash\('sha256'\)\.update\(canonicalBody, 'utf8'\)\.digest\('hex'\)/
  );
  assert.match(
    durable,
    /decide_earning_review_draft\(\$1::uuid,\$2::boolean,\$3::text,\$4::uuid,\$5::uuid,\$6::text,\$7::bigint\)/
  );
  assert.match(draft, /FORMAL-RELEASE DRAFT ONLY\. NOT A MIGRATION/);
  assert.doesNotMatch(draft, /create\s+or\s+replace\s+function\s+public\./i);
});
