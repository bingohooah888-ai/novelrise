import test from 'node:test';
import assert from 'node:assert/strict';
import { URL } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';

const sql = readFileSync(
  new URL(
    '../docs/plans/READER-REWARD-POINT10X-EXISTING-DB-ATOMIC-REVIEW-20261106.sql',
    import.meta.url
  ),
  'utf8'
);
const source = readFileSync(
  new URL(
    '../supabase/migrations/20260928061000_beta_rank_discovery_privacy.sql',
    import.meta.url
  ),
  'utf8'
).replace(/\r/g, '');

const scope = 'reader-reward-beta-point-tenfold-existing-db-staging-v1';
const functionStart =
  'create or replace function public.novelight_award_level_up_points()';
const rpc = (body) => {
  const a = body.indexOf(functionStart);
  const b = body.indexOf('$$;', a);
  assert.ok(a >= 0 && b > a, 'current live beta RPC must be present');
  return body.slice(a, b + 3).replace(/\r/g, '');
};

test('new scope is beta/staging-only and cannot reuse OWNER V3 read-only or other scopes', () => {
  assert.ok(sql.includes(scope));
  assert.ok(sql.includes('NL10_NEW_STAGING_ONLY_SCOPE_REQUIRED'));
  assert.ok(sql.includes('wmlzjgvxgoyrovdhbqbg'));
  assert.ok(sql.includes("novelight.point10x_owner_id', true)"));
  assert.ok(sql.includes("novelight.point10x_run_count', true)"));
  assert.ok(!sql.includes('fiepaguycecrredwrcwx'));
  assert.ok(
    !sql.includes(
      'reader-reward-beta-point-10x-staging-catalog-single-snapshot-readonly'
    )
  );
});

test('candidate is NOT an active migration or workflow and has no external runner', () => {
  assert.ok(
    !existsSync(
      new URL(
        '../supabase/migrations/20261106120000_reader_reward_point10x_existing_db.sql',
        import.meta.url
      )
    )
  );
  assert.ok(
    !existsSync(
      new URL(
        '../.github/workflows/scout-point10x-existing-db-cutover.yml',
        import.meta.url
      )
    )
  );
  assert.match(sql, /REVIEW ONLY/);
  assert.ok(!sql.includes('pg_net'));
});

test('one serializable transaction spans six-table freeze, updates, RPC and private marker', () => {
  assert.equal((sql.match(/^BEGIN;$/gm) || []).length, 1);
  assert.equal((sql.match(/^COMMIT;$/gm) || []).length, 1);
  assert.match(sql, /SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;/);
  assert.match(
    sql,
    /LOCK TABLE public.scout_event_ledger, public.scout_xp_ledger,/
  );
  assert.match(
    sql,
    /public.scout_point_ledger, public.scout_badge_definitions,/
  );
  assert.match(sql, /IN ACCESS EXCLUSIVE MODE;/);
  assert.ok(
    sql.indexOf('LOCK TABLE') < sql.indexOf('UPDATE public.scout_point_ledger')
  );
  assert.ok(
    sql.indexOf('UPDATE public.scout_point_operator_actions') <
      sql.indexOf(functionStart)
  );
  assert.ok(
    sql.indexOf(functionStart) < sql.indexOf('CREATE SCHEMA point10x_beta;')
  );
});

test('the five PR #2763 updates are present once, without ledger key or XP mutation', () => {
  const changes = [...sql.matchAll(/^UPDATE public\.([\w]+)\b/gm)].map(
    (x) => x[1]
  );
  assert.deepEqual(changes, [
    'scout_point_ledger',
    'scout_badge_definitions',
    'scout_badge_definitions',
    'user_scout_badges',
    'scout_point_operator_actions'
  ]);
  assert.match(sql, /SET point_value=\(point_value::bigint\*10\)::integer/);
  assert.match(sql, /SET point_reward=\(point_reward::bigint\*10\)::integer/);
  assert.match(sql, /SET target_value=target_value\*10::bigint/);
  assert.match(sql, /SET progress_value=progress_value\*10::bigint/);
  assert.match(sql, /SET amount=\(amount::bigint\*10\)::integer/);
  assert.doesNotMatch(sql, /UPDATE public\.scout_xp_ledger/);
  assert.doesNotMatch(sql, /UPDATE public\.scout_event_ledger/);
});

test('current hidden-discovery beta RPC is byte-preserved apart from award 5->50 and version', () => {
  const old = rpc(source);
  const count = (old.match(/^      5,$/gm) || []).length;
  assert.equal(count, 1, 'one award constant in current beta RPC');
  const expected = old
    .replace(/^      5,$/m, '      50,')
    .replace(
      'chapter49-beta-rank-private-v1',
      'chapter49-beta-rank-private-point10x-v1'
    );
  assert.equal(rpc(sql), expected);
  assert.ok(rpc(sql).includes("new.xp_kind = 'light_seed_discovery'"));
  assert.ok(rpc(sql).includes("and x.xp_kind <> 'light_seed_discovery'"));
  assert.match(rpc(sql), /security definer/);
  assert.match(rpc(sql), /set search_path = ''/);
});

test('level and badge function hashes are bound to read-only observed current definitions', () => {
  assert.ok(sql.includes('830b9784d2e7d5bdd71054188aa06e91'));
  assert.ok(sql.includes('e912c55468e49cdcf00be084f21d283b'));
  assert.ok(sql.includes('f016fc2098eb7e2dcfc50898fd5812a0'));
  assert.match(sql, /NL10_RPC_DRIFT/);
  assert.match(sql, /NL10_RPC_OR_PRIVILEGES_MISMATCH/);
});

test('no stale fixed Staging row counts; full row before-after checks remain', () => {
  assert.doesNotMatch(sql, /3581|12870|7162|1605/);
  for (const target of ['ledger', 'badges', 'progress', 'operator']) {
    assert.ok(sql.includes('nl10_before_' + target));
    assert.ok(
      sql.includes('NL10_' + target.toUpperCase()) || target === 'badges'
    );
  }
  assert.equal((sql.match(/FULL JOIN public\./g) || []).length, 4);
  assert.ok(sql.includes('to_jsonb(t) IS DISTINCT FROM'));
  assert.match(sql, /nl10_before_rpc/);
});

test('replay, overflow and unexpected schema/state fail closed', () => {
  assert.match(sql, /to_regnamespace\('point10x_beta'\) IS NOT NULL/);
  assert.match(sql, /NL10_RANGE_OR_REPLAY/);
  assert.match(sql, /NL10_POINT_BADGE_DRIFT/);
  assert.match(sql, /NOT c\.relrowsecurity/);
  assert.ok(sql.includes("badge_id='reader_point_100'"));
  assert.ok(sql.includes("badge_id='reader_point_500'"));
});

test('private durable marker records approval identity in same transaction', () => {
  assert.ok(sql.includes('CREATE SCHEMA point10x_beta;'));
  assert.ok(sql.includes('CREATE TABLE point10x_beta.unit_cutover'));
  assert.match(sql, /ENABLE ROW LEVEL SECURITY;/);
  assert.match(
    sql,
    /REVOKE ALL ON TABLE point10x_beta\.unit_cutover FROM PUBLIC, anon, authenticated/
  );
  assert.match(sql, /INSERT INTO point10x_beta\.unit_cutover/);
  assert.ok(
    sql.indexOf('CREATE TABLE point10x_beta.unit_cutover') <
      sql.lastIndexOf('COMMIT;')
  );
});

test('never provides authorization or read-only OWNER V3 reuse on import or CI', () => {
  assert.doesNotMatch(
    sql,
    /^\s*(?:CREATE OR REPLACE|CREATE) (?:TRIGGER|POLICY|EXTENSION)\b/gim
  );
  assert.doesNotMatch(sql, /^\s*GRANT\b/gim);
  assert.doesNotMatch(sql, /^\s*DELETE FROM\b/gim);
  assert.doesNotMatch(sql, /^\s*TRUNCATE\b/gim);
  assert.match(sql, /GUCs are not proof of GitHub identity/);
  assert.match(sql, /COMMIT ACK unknown: no retry/);
});
