import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import {
  ADDENDUM_SQL_PATH,
  ADDENDUM_SQL_SHA256,
  UNCHANGED_ORIGINAL_SQL_SHA256,
  ADDENDUM_IDS,
  ADDENDUM_ROLE_NAMES,
  ADDENDUM_SCOPE_STATUS,
  SOURCE_ANCHORS,
  EXPECTED_GAP_TRIGGERS,
  REQUIRED_ADDED_FUNCTIONS,
  readAddendumSql,
  reviewAddendumSql,
  readSourceAnchors,
  reviewSourcePrivilegeGaps,
  reconcileAddendumFixture
} from '../scripts/scout-point10x-privileged-catalog-addendum.mjs';
import {
  CATALOG_FUNCTIONS,
  PROPOSED_CATALOG_SCOPE,
  readPinnedCatalogSql,
  PINNED_CATALOG_SQL_SHA256
} from '../scripts/scout-point10x-catalog-readonly-review.mjs';
import { createHash } from 'node:crypto';
const sha = (x) => createHash('sha256').update(x).digest('hex');
function assertNoAuthority(r) {
  for (const key of [
    'addendumScopeApproved',
    'ownerAuthenticated',
    'spentLedgerCommitted',
    'actualCatalogRead',
    'realWriterStopped',
    'actualDataPlaneFenced',
    'mayConnectStaging',
    'mayReadDb',
    'mayRunSql',
    'mayWriteDb',
    'mayUseDocker',
    'mayClaimOwner',
    'mayMergeMain',
    'mayDeploy',
    'mayChangeProduction'
  ])
    assert.equal(r[key], false, key);
  assert.ok(Object.isFrozen(r));
  assert.ok(Object.isFrozen(r.blockers));
}
function denied(r, code) {
  assertNoAuthority(r);
  assert.ok(
    r.blockers.includes(code),
    'missing ' + code + ' in ' + r.blockers.join(',')
  );
}
function fixture() {
  return {
    'NL-GAP-01': EXPECTED_GAP_TRIGGERS.map((x) => ({
      evidence_id: 'NL-GAP-01',
      table_schema: 'public',
      table_name: 'synthetic_scout_event',
      table_owner: 'synthetic_readonly_role',
      trigger_name: x.trigger,
      trigger_enable_state: 'O',
      internal_trigger: false,
      invoked_function_identity: 'public.' + x.function,
      function_owner: 'synthetic_owner',
      owner_superuser: false,
      owner_bypassrls: false,
      is_security_definer: false,
      function_has_fixed_search_path: true,
      service_role_can_execute: false,
      trigger_type_mask: 5
    })),
    'NL-GAP-02': REQUIRED_ADDED_FUNCTIONS.flatMap((f) =>
      ADDENDUM_ROLE_NAMES.map((target_role) => ({
        evidence_id: 'NL-GAP-02',
        function_identity: 'public.' + f,
        function_owner: 'synthetic_owner',
        owner_superuser: false,
        owner_bypassrls: false,
        is_security_definer: false,
        function_has_fixed_search_path: true,
        explicit_function_acl_present: true,
        target_role,
        role_found: true,
        role_can_execute: false,
        referenced_by_trigger: true
      }))
    ),
    'NL-GAP-03': ADDENDUM_ROLE_NAMES.map((target_role) => ({
      evidence_id: 'NL-GAP-03',
      relation_identity: 'public.synthetic_event',
      relation_owner: 'synthetic_owner',
      owner_superuser: false,
      owner_bypassrls: false,
      rls_enabled: true,
      rls_forced: true,
      target_role,
      role_found: true,
      can_insert: false,
      can_update: false,
      can_delete: false,
      can_truncate: false,
      can_trigger: false
    }))
  };
}
test('existing 8-query SHA remains exactly pinned to original bytes', () => {
  assert.equal(PINNED_CATALOG_SQL_SHA256, UNCHANGED_ORIGINAL_SQL_SHA256);
  assert.equal(sha(readPinnedCatalogSql()), UNCHANGED_ORIGINAL_SQL_SHA256);
});
test('addendum is a new inert plans SQL, byte-pinned separately', () => {
  assert.equal(
    ADDENDUM_SQL_PATH,
    'docs/plans/READER-REWARD-POINT10X-STAGING-PRIVILEGED-CATALOG-ADDENDUM-20261105.sql'
  );
  assert.equal(sha(readAddendumSql()), ADDENDUM_SQL_SHA256);
  assert.notEqual(ADDENDUM_SQL_SHA256, UNCHANGED_ORIGINAL_SQL_SHA256);
});
test('old OWNER read-only scope cannot authorize new SQL bytes', () => {
  assert.equal(
    ADDENDUM_SCOPE_STATUS,
    'NEW_SQL_DIGEST_NEEDS_SEPARATE_OWNER_APPROVAL'
  );
  assert.equal(
    PROPOSED_CATALOG_SCOPE,
    'reader-reward-beta-point-10x-staging-catalog-readonly'
  );
  denied(
    reviewAddendumSql(readAddendumSql()),
    'NO_OWNER_APPROVAL_FOR_NEW_SQL_DIGEST'
  );
});
test('addendum is not an active migration or executable query', () => {
  const r = reviewAddendumSql(readAddendumSql());
  assert.equal(r.statementCount, 5);
  assert.equal(r.sectionCount, 3);
  assert.equal(r.digest, ADDENDUM_SQL_SHA256);
  assertNoAuthority(r);
  denied(
    reviewAddendumSql(
      readAddendumSql(),
      'supabase/migrations/20261105000000_unsafe.sql'
    ),
    'ADDENDUM_MUST_STAY_OUTSIDE_ACTIVE_MIGRATIONS'
  );
});
test('source and addendum each have explicit three catalog sections', () => {
  const src = readAddendumSql().toString();
  assert.deepEqual(ADDENDUM_IDS, ['NL-GAP-01', 'NL-GAP-02', 'NL-GAP-03']);
  for (const id of ADDENDUM_IDS) assert.ok(src.includes('-- ' + id + ':'));
  assert.match(src, /REPEATABLE READ READ ONLY/u);
  assert.ok(src.trimEnd().endsWith('ROLLBACK;'));
});
test('addendum reads neither source rows nor function bodies', () => {
  const src = readAddendumSql().toString();
  assert.doesNotMatch(
    src,
    /\bFROM\s+public\.(?:scout_xp_ledger|scout_point_ledger|user_scout_badges)/iu
  );
  assert.doesNotMatch(src, /\bpg_get_functiondef\s*\(/iu);
  assert.doesNotMatch(src, /\bFROM\s+cron\.job\b/iu);
  assert.doesNotMatch(src, /\bpg_authid\b/iu);
  assert.match(src, /has_function_privilege/u);
  assert.match(src, /has_table_privilege/u);
  assert.match(src, /rolbypassrls/u);
});
for (const t of [
  'pg_catalog.pg_trigger',
  'pg_catalog.pg_proc',
  'pg_catalog.pg_roles'
]) {
  test('addendum explicitly includes ' + t, () => {
    assert.ok(readAddendumSql().toString().includes(t));
  });
}
test('mutating SQL bytes after hash pin are refused', () => {
  denied(
    reviewAddendumSql(Buffer.concat([readAddendumSql(), Buffer.from('\n')])),
    'ADDENDUM_SQL_BYTES_CHANGED'
  );
});
for (const sql of [
  'UPDATE public.scout_point_ledger SET point_value=5;',
  'DELETE FROM public.scout_xp_ledger;',
  'TRUNCATE public.scout_point_ledger;',
  'GRANT ALL ON public.scout_point_ledger TO service_role;',
  'ALTER TABLE public.scout_point_ledger DISABLE TRIGGER USER;',
  'DO $$ BEGIN NULL; END $$;',
  'CALL public.unsafe();'
]) {
  test(
    'dangerous SQL injected into addendum does not pass: ' + sql.slice(0, 25),
    () => {
      const candidate = readAddendumSql()
        .toString()
        .replace('ROLLBACK;', sql + '\nROLLBACK;');
      const r = reviewAddendumSql(candidate);
      denied(r, 'DANGEROUS_KEYWORD_IN_SQL_CANDIDATE');
      denied(r, 'ADDENDUM_SQL_BYTES_CHANGED');
    }
  );
}
for (const id of ADDENDUM_IDS) {
  test('missing SQL section ' + id + ' is detected', () => {
    const text = readAddendumSql()
      .toString()
      .replace('-- ' + id + ':', '-- MISSING:');
    denied(reviewAddendumSql(text), 'MISSING_OR_DUPLICATE_SQL_SECTION:' + id);
  });
}
test('read-write transaction and missing rollback refused', () => {
  denied(
    reviewAddendumSql(
      readAddendumSql()
        .toString()
        .replace(
          'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;',
          'BEGIN;'
        )
    ),
    'READONLY_TRANSACTION_REQUIRED'
  );
  denied(
    reviewAddendumSql(readAddendumSql().toString().replace('ROLLBACK;', '')),
    'EXPLICIT_ROLLBACK_REQUIRED'
  );
});
test('arbitrary values and missing bytes denied', () => {
  denied(reviewAddendumSql(null), 'SQL_BYTES_REQUIRED');
  denied(reviewAddendumSql({}), 'SQL_BYTES_REQUIRED');
});
test('historical source anchors are found with line numbers, not live proof', () => {
  const r = reviewSourcePrivilegeGaps(readSourceAnchors());
  assert.equal(r.foundCount, 15);
  assert.ok(
    r.sourceAnchors.every((x) => Number.isInteger(x.line) && x.line > 0)
  );
  denied(r, 'SOURCE_IS_NOT_LIVE_FUNCTION_OR_ACL_PROOF');
  denied(r, 'SECDEF_AND_SERVICE_ROLE_REAL_CATALOG_STILL_UNKNOWN');
});
for (const a of SOURCE_ANCHORS) {
  test('missing pinned migration blocks source review: ' + a.path, () => {
    const s = readSourceAnchors();
    s.delete(a.path);
    denied(reviewSourcePrivilegeGaps(s), 'SOURCE_MISSING:' + a.path);
  });
}
test('migration tampering does not yield green source status', () => {
  const m = readSourceAnchors(),
    target = SOURCE_ANCHORS[0];
  m.set(target.path, m.get(target.path).replace(target.terms[0], 'replaced'));
  denied(reviewSourcePrivilegeGaps(m), 'SOURCE_TERM_MISSING:' + target.path);
});
test('bad source input is denied', () => {
  denied(reviewSourcePrivilegeGaps([]), 'SOURCE_MAP_REQUIRED');
});
test('read XP trigger function omitted from original 12-function list', () => {
  assert.equal(
    CATALOG_FUNCTIONS.some((f) =>
      f.includes('novelight_award_valid_read_scout_xp')
    ),
    false
  );
  assert.ok(
    REQUIRED_ADDED_FUNCTIONS.includes('novelight_award_valid_read_scout_xp()')
  );
  assert.equal(EXPECTED_GAP_TRIGGERS[0].trigger, 'scout_event_valid_read_xp');
});
test('source-only inspection identifies second later XP function definition', () => {
  const r = reviewSourcePrivilegeGaps(readSourceAnchors());
  assert.equal(r.redefinedReadXpFunctionSourceOnly, true);
  assert.equal(r.knownRenamedLegacyFunctionsSourceOnly, true);
  assertNoAuthority(r);
});
test('perfect fake catalog remains NO-GO and never enables SQL execution', () => {
  const r = reconcileAddendumFixture(fixture());
  assert.equal(r.status, 'NO_GO_ADDENDUM_FIXTURE_ONLY');
  assert.equal(r.triggerRowsSeen, 4);
  assert.equal(r.functionRoleRowsSeen, REQUIRED_ADDED_FUNCTIONS.length * 3);
  assert.equal(r.tableRoleRowsSeen, 3);
  assert.equal(r.newSqlRequiresDistinctPinnedApproval, true);
  assertNoAuthority(r);
});
for (const code of [
  'ADDENDUM_FIXTURE_NOT_LIVE_STAGING',
  'TRIGGER_FUNCTIONS_AND_EVERY_OWNER_NOT_PROVEN_FENCED',
  'UNKNOWN_FUNCTION_AND_OUTSIDE_DATABASE_WRITERS_UNEXCLUDED',
  'ORIGINAL_CATALOG_SCOPE_NOT_AUTHORITY_FOR_ADDENDUM'
]) {
  test('synthetic fixture can never resolve permanent blocker: ' + code, () => {
    denied(reconcileAddendumFixture(fixture()), code);
  });
}
test('empty or malformed catalog sections are never accepted', () => {
  denied(reconcileAddendumFixture(null), 'THREE_CATALOG_SECTIONS_REQUIRED');
  denied(reconcileAddendumFixture({}), 'MISSING_SECTION:NL-GAP-01');
  const f = fixture();
  f['NL-GAP-02'] = [null];
  denied(reconcileAddendumFixture(f), 'MALFORMED_ROW:NL-GAP-02');
});
for (const id of ADDENDUM_IDS) {
  test('missing addendum section is a blocker: ' + id, () => {
    const f = fixture();
    delete f[id];
    denied(reconcileAddendumFixture(f), 'MISSING_SECTION:' + id);
  });
}
test('extra sections and secret columns are blocked without leaking values', () => {
  const f = fixture();
  f['NL-GAP-99'] = [];
  f['NL-GAP-01'][0].password = 'SECRET_TEST_ONLY';
  const r = reconcileAddendumFixture(f);
  denied(r, 'EXTRA_SECTION_DENIED');
  denied(r, 'UNKNOWN_OUTPUT_FIELD:NL-GAP-01');
  assert.ok(!JSON.stringify(r).includes('SECRET_TEST_ONLY'));
});
for (const e of EXPECTED_GAP_TRIGGERS) {
  test('missing pinned trigger is NOT inferred inactive: ' + e.trigger, () => {
    const f = fixture();
    f['NL-GAP-01'] = f['NL-GAP-01'].filter((x) => x.trigger_name !== e.trigger);
    denied(
      reconcileAddendumFixture(f),
      'TRIGGER_CARDINALITY_UNVERIFIED:' + e.trigger
    );
  });
  test('wrong function bound to trigger is blocked: ' + e.trigger, () => {
    const f = fixture();
    f['NL-GAP-01'].find(
      (x) => x.trigger_name === e.trigger
    ).invoked_function_identity = 'public.unreviewed_privileged_function()';
    denied(reconcileAddendumFixture(f), 'TRIGGER_TARGET_MISMATCH:' + e.trigger);
  });
}
test('disabled or replica-only expected triggers are rejected', () => {
  const f = fixture();
  f['NL-GAP-01'][0].trigger_enable_state = 'D';
  denied(
    reconcileAddendumFixture(f),
    'TRIGGER_NOT_ORIGIN_ENABLED:scout_event_valid_read_xp'
  );
  f['NL-GAP-01'][0].trigger_enable_state = 'R';
  denied(
    reconcileAddendumFixture(f),
    'TRIGGER_NOT_ORIGIN_ENABLED:scout_event_valid_read_xp'
  );
});
test('unregistered trigger is a privileged path candidate', () => {
  const f = fixture();
  f['NL-GAP-01'].push({
    ...f['NL-GAP-01'][0],
    trigger_name: 'scout_unregistered_trigger'
  });
  denied(reconcileAddendumFixture(f), 'UNREGISTERED_TRIGGER_REQUIRES_REVIEW');
});
test('SECDEF trigger and missing search_path are not considered safe', () => {
  const f = fixture();
  f['NL-GAP-01'][0].is_security_definer = true;
  f['NL-GAP-01'][0].function_has_fixed_search_path = false;
  denied(
    reconcileAddendumFixture(f),
    'PRIVILEGED_TRIGGER_FUNCTION:scout_event_valid_read_xp'
  );
  denied(
    reconcileAddendumFixture(f),
    'TRIGGER_SEARCH_PATH_UNKNOWN:scout_event_valid_read_xp'
  );
});
test('service_role EXECUTE on trigger function is a blocker', () => {
  const f = fixture();
  f['NL-GAP-01'][0].service_role_can_execute = true;
  denied(
    reconcileAddendumFixture(f),
    'TRIGGER_SERVICE_ROLE_EXECUTE_NOT_REVOKED:scout_event_valid_read_xp'
  );
});
test('privileged trigger function owner is a blocker', () => {
  const f = fixture();
  f['NL-GAP-01'][0].owner_bypassrls = true;
  denied(
    reconcileAddendumFixture(f),
    'TRIGGER_OWNER_BYPASS_NOT_DISPROVEN:scout_event_valid_read_xp'
  );
});
for (const name of REQUIRED_ADDED_FUNCTIONS) {
  test('missing one role coverage for required function ' + name, () => {
    const f = fixture();
    f['NL-GAP-02'] = f['NL-GAP-02'].filter(
      (x) => !(x.function_identity.endsWith(name) && x.target_role === 'anon')
    );
    denied(
      reconcileAddendumFixture(f),
      'FUNCTION_ROLE_COVERAGE_MISSING:' + name
    );
  });
}
test('old renamed seed internal function callable is a blocker', () => {
  const f = fixture();
  const x = f['NL-GAP-02'].find(
    (x) =>
      x.function_identity.endsWith(
        'novelight_process_seed_discovery_rank_internal_20260928(uuid)'
      ) && x.target_role === 'service_role'
  );
  x.role_can_execute = true;
  denied(
    reconcileAddendumFixture(f),
    'FUNCTION_CALLABLE_BY_ROLE:novelight_process_seed_discovery_rank_internal_20260928(uuid):service_role'
  );
});
test('PUBLIC equivalent via anon authenticated effective EXECUTE is caught', () => {
  const f = fixture();
  const x = f['NL-GAP-02'].find((x) => x.target_role === 'authenticated');
  x.role_can_execute = true;
  denied(
    reconcileAddendumFixture(f),
    'FUNCTION_CALLABLE_BY_ROLE:' +
      REQUIRED_ADDED_FUNCTIONS[0] +
      ':authenticated'
  );
});
test('unknown owner flags and missing search_path not silently accepted', () => {
  const f = fixture();
  f['NL-GAP-02'][0].owner_superuser = null;
  f['NL-GAP-02'][0].is_security_definer = true;
  f['NL-GAP-02'][0].function_has_fixed_search_path = false;
  denied(
    reconcileAddendumFixture(f),
    'FUNCTION_OWNER_PRIVILEGE_UNCLOSED:' + REQUIRED_ADDED_FUNCTIONS[0]
  );
  denied(
    reconcileAddendumFixture(f),
    'SECDEF_SEARCH_PATH_MISSING:' + REQUIRED_ADDED_FUNCTIONS[0]
  );
});
test('new unknown privileged public function cannot be considered covered', () => {
  const f = fixture();
  f['NL-GAP-02'].push({
    ...f['NL-GAP-02'][0],
    function_identity: 'public.novelight_future_point_awarder()'
  });
  denied(
    reconcileAddendumFixture(f),
    'UNKNOWN_PRIVILEGED_FUNCTION_REQUIRES_REVIEW'
  );
});
test('unknown EXECUTE privilege is not false', () => {
  const f = fixture();
  f['NL-GAP-02'][0].role_can_execute = null;
  denied(
    reconcileAddendumFixture(f),
    'FUNCTION_EFFECTIVE_EXECUTE_UNKNOWN:' + REQUIRED_ADDED_FUNCTIONS[0]
  );
});
for (const field of [
  'can_insert',
  'can_update',
  'can_delete',
  'can_truncate',
  'can_trigger'
]) {
  test(
    'table-side effective privilege cannot be silently ignored: ' + field,
    () => {
      const f = fixture();
      f['NL-GAP-03'][0][field] = true;
      denied(
        reconcileAddendumFixture(f),
        'TABLE_PRIVILEGE_UNPROVEN:public.synthetic_event|service_role:' + field
      );
    }
  );
}
test('unknown table privilege is not an enforced denial', () => {
  const f = fixture();
  f['NL-GAP-03'][0].can_truncate = null;
  denied(
    reconcileAddendumFixture(f),
    'TABLE_PRIVILEGE_UNPROVEN:public.synthetic_event|service_role:can_truncate'
  );
});
test('missing table-side evidence does not give GO', () => {
  const f = fixture();
  f['NL-GAP-03'] = [];
  denied(reconcileAddendumFixture(f), 'TRIGGER_TABLE_ACLS_NOT_ENUMERATED');
});
test('duplicated table role privilege requires manual review', () => {
  const f = fixture();
  f['NL-GAP-03'].push({ ...f['NL-GAP-03'][0] });
  denied(reconcileAddendumFixture(f), 'DUPLICATE_TABLE_ROLE_PRIVILEGE');
});
test('appended SQL and checker cannot call database, docker or owner API', () => {
  const src = readFileSync(
    fileURLToPath(
      new URL(
        '../scripts/scout-point10x-privileged-catalog-addendum.mjs',
        import.meta.url
      )
    ),
    'utf8'
  );
  assert.doesNotMatch(src, /spawnSync\(['"]docker['"]/u);
  assert.doesNotMatch(src, /createClient\s*\(/u);
  assert.doesNotMatch(src, /execute_sql\s*\(/u);
  assert.doesNotMatch(src, /https?:\/\//u);
  assert.match(src, /mayRunSql:\s*false/u);
  assert.match(src, /mayClaimOwner:\s*false/u);
});
