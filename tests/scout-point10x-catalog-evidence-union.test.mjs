import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import {
  PINNED_CATALOG_SQL_SHA256,
  PROPOSED_CATALOG_SCOPE,
  CATALOG_RELATIONS,
  CATALOG_FUNCTIONS,
  CATALOG_ROLES,
  readPinnedCatalogSql
} from '../scripts/scout-point10x-catalog-readonly-review.mjs';
import {
  ADDENDUM_SQL_SHA256,
  UNCHANGED_ORIGINAL_SQL_SHA256,
  ADDENDUM_ROLE_NAMES,
  EXPECTED_GAP_TRIGGERS,
  REQUIRED_ADDED_FUNCTIONS,
  readAddendumSql
} from '../scripts/scout-point10x-privileged-catalog-addendum.mjs';
import { CATALOG_EXPECTED_TRIGGERS } from '../scripts/scout-point10x-catalog-result-reconciler.mjs';
import {
  STAGING_PROJECT,
  PRODUCTION_PROJECT
} from '../scripts/scout-point10x-atomic-execution-contract.mjs';
import { MUTATION_DOMAIN } from '../scripts/scout-point10x-durable-fence-model.mjs';
import {
  PROPOSED_BUNDLE_SCOPE,
  BUNDLE_SQL_HASHES,
  BUNDLE_REVIEW_STEPS,
  BUNDLE_REVIEW_BLOCKERS,
  reviewTwoCatalogEvidence,
  computeProposedBundleDigest,
  reviewTrustedMainCatalogBundleContract,
  newOfflineBundleClaimState,
  simulateBundleOneShotCas
} from '../scripts/scout-point10x-catalog-evidence-union.mjs';
const sha = (x) => createHash('sha256').update(x).digest('hex');
const normalize = (x) => x.replace(/^public\./u, '');
const digests = () => ({ ...BUNDLE_SQL_HASHES });
const allTriggers = [
  ...CATALOG_EXPECTED_TRIGGERS,
  ...EXPECTED_GAP_TRIGGERS.filter(
    (t) => !CATALOG_EXPECTED_TRIGGERS.some((x) => x.trigger === t.trigger)
  ).map((t) => ({
    relation: t.trigger.includes('metric_state')
      ? 'scout_badge_metric_state'
      : t.trigger.includes('point')
        ? 'scout_point_ledger'
        : 'scout_xp_ledger',
    ...t
  }))
];
function fakeBase() {
  return {
    'NL-CATALOG-01': [
      {
        evidence_id: 'NL-CATALOG-01',
        database_name: 'synthetic_catalog',
        current_role_name: 'synthetic_ro',
        session_role_name: 'synthetic_ro',
        pg_server_version_num: '150017',
        transaction_read_only: 'on',
        is_in_recovery: false
      }
    ],
    'NL-CATALOG-02': CATALOG_RELATIONS.map((expected_relation) => ({
      evidence_id: 'NL-CATALOG-02',
      expected_relation,
      found: true,
      relkind: 'r',
      table_owner: 'postgres',
      rls_enabled: true,
      force_rls: true,
      explicit_acl: null,
      tested_role: 'service_role',
      tested_role_bypassrls: false,
      tested_role_superuser: false,
      can_insert: false,
      can_update: false,
      can_delete: false,
      can_truncate: false,
      can_trigger: false
    })),
    'NL-CATALOG-03': CATALOG_EXPECTED_TRIGGERS.map((t) => ({
      evidence_id: 'NL-CATALOG-03',
      expected_relation: t.relation,
      relation_found: true,
      trigger_name: t.trigger,
      trigger_enabled_state: 'O',
      internal_trigger: false,
      invoked_function: 'public.' + t.function,
      trigger_definition: 'SYNTHETIC NOT EXECUTABLE'
    })),
    'NL-CATALOG-04': CATALOG_FUNCTIONS.map((signature) => ({
      evidence_id: 'NL-CATALOG-04',
      signature,
      found: true,
      deployed_identity: signature,
      function_owner: 'postgres',
      is_security_definer: false,
      function_session_settings: [],
      explicit_execute_acl: null,
      function_definition_md5: 'a'.repeat(32),
      tested_role: 'service_role',
      role_can_execute: false
    })),
    'NL-CATALOG-05': CATALOG_ROLES.map((expected_role) => ({
      evidence_id: 'NL-CATALOG-05',
      expected_role,
      found: true,
      rolsuper: false,
      rolbypassrls: false,
      rolinherit: true,
      rolcreaterole: false,
      rolcreatedb: false,
      rolcanlogin: true
    })),
    'NL-CATALOG-06': [],
    'NL-CATALOG-07': [
      {
        evidence_id: 'NL-CATALOG-07',
        schema_name: 'public',
        schema_owner: 'postgres',
        schema_acl: null,
        default_object_type: null,
        default_grant_owner: null,
        default_acl: null
      }
    ],
    'NL-CATALOG-08': [
      {
        evidence_id: 'NL-CATALOG-08',
        cron_job_relation_exists: false,
        pg_cron_extension_installed: false
      }
    ]
  };
}
function fakeAddendum() {
  const funcs = new Set([
    ...CATALOG_FUNCTIONS.map(normalize),
    ...REQUIRED_ADDED_FUNCTIONS
  ]);
  return {
    'NL-GAP-01': allTriggers.map((t) => ({
      evidence_id: 'NL-GAP-01',
      table_schema: 'public',
      table_name: t.relation,
      table_owner: 'postgres',
      trigger_name: t.trigger,
      trigger_enable_state: 'O',
      internal_trigger: false,
      invoked_function_identity: 'public.' + t.function,
      function_owner: 'postgres',
      owner_superuser: false,
      owner_bypassrls: false,
      is_security_definer: false,
      function_has_fixed_search_path: true,
      service_role_can_execute: false,
      trigger_type_mask: 5
    })),
    'NL-GAP-02': [...funcs].flatMap((fn) =>
      ADDENDUM_ROLE_NAMES.map((target_role) => ({
        evidence_id: 'NL-GAP-02',
        function_identity: 'public.' + fn,
        function_owner: 'postgres',
        owner_superuser: false,
        owner_bypassrls: false,
        is_security_definer: false,
        function_has_fixed_search_path: true,
        explicit_function_acl_present: false,
        target_role,
        role_found: true,
        role_can_execute: false,
        referenced_by_trigger: true
      }))
    ),
    'NL-GAP-03': CATALOG_RELATIONS.flatMap((rel) =>
      ADDENDUM_ROLE_NAMES.map((target_role) => ({
        evidence_id: 'NL-GAP-03',
        relation_identity: 'public.' + rel,
        relation_owner: 'postgres',
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
    )
  };
}
function input() {
  return { base: fakeBase(), addendum: fakeAddendum(), sqlDigests: digests() };
}
const change = (fn) => {
  const x = input();
  fn(x);
  return reviewTwoCatalogEvidence(x);
};
const request = () => ({
  scope: PROPOSED_BUNDLE_SCOPE,
  issueNumber: 294,
  operation: 'read-catalog-bundle-only',
  stagingRef: STAGING_PROJECT,
  mainSha: 'a'.repeat(40),
  headSha: 'b'.repeat(40),
  sqlDigests: digests(),
  bundleDigest: computeProposedBundleDigest(),
  commentId: 91357
});
function safe(result) {
  for (const name of [
    'actualDbContacted',
    'bothQueriesRunInSameRealSnapshot',
    'actualOwnerAuthenticated',
    'actualOwnerApprovalConsumed',
    'actualSpentCasCommitted',
    'actualAllWritersFenced',
    'mayReadDb',
    'mayRunSql',
    'mayWriteDb',
    'mayUseDocker',
    'mayRunStaging',
    'mayClaimOwner',
    'mayMergeMain',
    'mayDeploy',
    'mayChangeProduction'
  ])
    assert.equal(result[name], false, name);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.blockers));
}
function blocked(result, reason) {
  assert.ok(
    result.blockers.includes(reason),
    'missing ' + reason + ' among ' + result.blockers.join(',')
  );
  safe(result);
}
test('original eight-query and independent three-query SHA256 unchanged', () => {
  assert.equal(UNCHANGED_ORIGINAL_SQL_SHA256, PINNED_CATALOG_SQL_SHA256);
  assert.equal(sha(readPinnedCatalogSql()), BUNDLE_SQL_HASHES.base);
  assert.equal(sha(readAddendumSql()), BUNDLE_SQL_HASHES.addendum);
  assert.equal(ADDENDUM_SQL_SHA256, BUNDLE_SQL_HASHES.addendum);
  assert.notEqual(BUNDLE_SQL_HASHES.base, BUNDLE_SQL_HASHES.addendum);
  assert.equal(Object.keys(BUNDLE_SQL_HASHES).length, 2);
});
test('both code paths are deliberately inert even with matching fake catalogs', () => {
  const r = reviewTwoCatalogEvidence(input());
  assert.equal(r.status, 'NO_GO_UNTRUSTED_CATALOG_UNION');
  assert.equal(r.comparedTriggers, 4);
  assert.equal(r.comparedFunctionSignatures, CATALOG_FUNCTIONS.length);
  assert.equal(r.comparedRelations, CATALOG_RELATIONS.length);
  assert.equal(r.writerClassCount, 9);
  assert.equal(r.privilegedPathCategoryCount, 5);
  assert.equal(r.unknownPrivilegedWritersRuledOut, false);
  safe(r);
});
for (const permanent of BUNDLE_REVIEW_BLOCKERS) {
  test('two clean-looking fixtures never clear blocker: ' + permanent, () => {
    blocked(reviewTwoCatalogEvidence(input()), permanent);
  });
}
test('missing base or addendum does not count as partial proof', () => {
  blocked(reviewTwoCatalogEvidence(), 'BOTH_CATALOG_FIXTURES_REQUIRED');
  blocked(
    reviewTwoCatalogEvidence({ base: fakeBase() }),
    'BOTH_CATALOG_FIXTURES_REQUIRED'
  );
});
test('missing or swapped digest denies union claim', () => {
  blocked(
    change((x) => {
      x.sqlDigests.base = 'f'.repeat(64);
    }),
    'BOTH_PINNED_SQL_HASHES_REQUIRED'
  );
  blocked(
    change((x) => {
      x.sqlDigests = {
        base: BUNDLE_SQL_HASHES.addendum,
        addendum: BUNDLE_SQL_HASHES.base
      };
    }),
    'BOTH_PINNED_SQL_HASHES_REQUIRED'
  );
  blocked(
    change((x) => {
      x.sqlDigests = { ...digests(), extra: 'foo' };
    }),
    'BOTH_PINNED_SQL_HASHES_REQUIRED'
  );
});
test('unknown source field never appears in result', () => {
  const r = change((x) => {
    x.base['NL-CATALOG-01'][0].database_name = 'PRIVATE_FIXTURE_DONT_PRINT';
    x.addendum['NL-GAP-02'][0].apiToken = 'SECRET_DONT_PRINT';
  });
  safe(r);
  assert.ok(!JSON.stringify(r).includes('PRIVATE_FIXTURE_DONT_PRINT'));
  assert.ok(!JSON.stringify(r).includes('SECRET_DONT_PRINT'));
});
test('baseline section missing is reported', () => {
  const r = change((x) => {
    delete x.base['NL-CATALOG-04'];
  });
  blocked(r, 'BASE_SECTION_MISSING:NL-CATALOG-04');
});
test('addendum section missing is reported', () => {
  const r = change((x) => {
    delete x.addendum['NL-GAP-02'];
  });
  blocked(r, 'ADDENDUM_SECTION_MISSING:NL-GAP-02');
});
test('duplicate trigger in baseline is blocked', () => {
  blocked(
    change((x) => {
      x.base['NL-CATALOG-03'].push({ ...x.base['NL-CATALOG-03'][0] });
    }),
    'BASE_TRIGGER_DUPLICATE_KEY'
  );
});
test('duplicate trigger in addendum is blocked', () => {
  blocked(
    change((x) => {
      x.addendum['NL-GAP-01'].push({ ...x.addendum['NL-GAP-01'][0] });
    }),
    'GAP_TRIGGER_DUPLICATE_KEY'
  );
});
for (const target of CATALOG_EXPECTED_TRIGGERS) {
  test('baseline trigger missing from addendum: ' + target.trigger, () => {
    const r = change((x) => {
      x.addendum['NL-GAP-01'] = x.addendum['NL-GAP-01'].filter(
        (t) => t.trigger_name !== target.trigger
      );
    });
    blocked(r, 'BASE_TRIGGER_NOT_IN_ADDENDUM');
  });
}
test('trigger enablement contradiction detected even if both snapshots look valid', () => {
  blocked(
    change((x) => {
      x.base['NL-CATALOG-03'][0].trigger_enabled_state = 'A';
      x.addendum['NL-GAP-01'][0].trigger_enable_state = 'O';
    }),
    'TRIGGER_ENABLED_STATE_CONTRADICTION'
  );
});
test('same trigger bound to different function detected', () => {
  blocked(
    change((x) => {
      x.base['NL-CATALOG-03'][0].invoked_function =
        'public.novelight_award_level_up_points()';
      x.addendum['NL-GAP-01'][0].invoked_function_identity =
        'public.some_other_award()';
    }),
    'TRIGGER_FUNCTION_TARGET_CONTRADICTION'
  );
});
test('malformed function identity never gets loosely normalized', () => {
  blocked(
    change((x) => {
      x.addendum['NL-GAP-01'][0].invoked_function_identity =
        'public.novelight_award_level_up_points(); DROP';
    }),
    'TRIGGER_FUNCTION_IDENTITY_UNRESOLVED'
  );
});
test('new privileged trigger not in baseline treated as unknown', () => {
  blocked(
    change((x) => {
      x.addendum['NL-GAP-01'].push({
        ...x.addendum['NL-GAP-01'][0],
        trigger_name: 'scout_hidden_writer'
      });
    }),
    'EXTRA_PRIVILEGED_TRIGGER_NOT_BASELINE_VERIFIED'
  );
});
test('missing base function coverage in addendum detected', () => {
  const sig = normalize(CATALOG_FUNCTIONS[0]);
  blocked(
    change((x) => {
      x.addendum['NL-GAP-02'] = x.addendum['NL-GAP-02'].filter(
        (r) => !r.function_identity.endsWith(sig)
      );
    }),
    'BASE_FUNCTION_NOT_IN_ADDENDUM'
  );
});
test('base function flagged absent but addendum sees it is contradiction', () => {
  blocked(
    change((x) => {
      x.base['NL-CATALOG-04'][0].found = false;
    }),
    'FUNCTION_PRESENCE_CONTRADICTION'
  );
});
test('duplicate function service_role row rejected', () => {
  blocked(
    change((x) => {
      x.addendum['NL-GAP-02'].push({ ...x.addendum['NL-GAP-02'][0] });
    }),
    'GAP_FUNCTION_ROLE_DUPLICATE_KEY'
  );
});
test('same function owner mismatch reported across two packs', () => {
  blocked(
    change((x) => {
      x.base['NL-CATALOG-04'][0].function_owner = 'owner_alpha';
      x.addendum['NL-GAP-02'][0].function_owner = 'owner_beta';
    }),
    'FUNCTION_OWNER_CONTRADICTION'
  );
});
test('same function SECDEF vs INVOKER mismatch reported', () => {
  blocked(
    change((x) => {
      x.base['NL-CATALOG-04'][0].is_security_definer = true;
      x.addendum['NL-GAP-02'][0].is_security_definer = false;
    }),
    'FUNCTION_SECDEF_CONTRADICTION'
  );
});
test('service_role effective EXECUTE mismatch reported', () => {
  blocked(
    change((x) => {
      x.base['NL-CATALOG-04'][0].role_can_execute = true;
      x.addendum['NL-GAP-02'][0].role_can_execute = false;
    }),
    'FUNCTION_EXECUTE_CONTRADICTION'
  );
});
test('unknown EXECUTE is never equivalent to false', () => {
  blocked(
    change((x) => {
      x.base['NL-CATALOG-04'][0].role_can_execute = null;
    }),
    'FUNCTION_EXECUTE_UNKNOWN_IN_ONE_PACK'
  );
});
test('explicit ACL presence contradiction reported', () => {
  blocked(
    change((x) => {
      x.base['NL-CATALOG-04'][0].explicit_execute_acl =
        '{service_role=X/postgres}';
      x.addendum['NL-GAP-02'][0].explicit_function_acl_present = false;
    }),
    'FUNCTION_EXPLICIT_ACL_PRESENCE_CONTRADICTION'
  );
});
test('inverse explicit ACL contradiction reported', () => {
  blocked(
    change((x) => {
      x.base['NL-CATALOG-04'][0].explicit_execute_acl = null;
      x.addendum['NL-GAP-02'][0].explicit_function_acl_present = true;
    }),
    'FUNCTION_EXPLICIT_ACL_PRESENCE_CONTRADICTION'
  );
});
for (const signature of REQUIRED_ADDED_FUNCTIONS) {
  test('required added function must be represented: ' + signature, () => {
    blocked(
      change((x) => {
        x.addendum['NL-GAP-02'] = x.addendum['NL-GAP-02'].filter(
          (row) => !row.function_identity.endsWith(signature)
        );
      }),
      'REQUIRED_NEW_FUNCTION_MISSING_FROM_UNION'
    );
  });
}
test('unknown nonregistered SECDEF function requires explicit review', () => {
  blocked(
    change((x) => {
      x.addendum['NL-GAP-02'].push({
        ...x.addendum['NL-GAP-02'][0],
        function_identity: 'public.novelight_secret_scout_grant()'
      });
    }),
    'NEW_PRIVILEGED_FUNCTION_NOT_BASELINE_REVIEWED'
  );
});
test('new definer route remains a blocker', () => {
  blocked(
    change((x) => {
      x.addendum['NL-GAP-02'][0].is_security_definer = true;
    }),
    'PRIVILEGED_SECDEF_MUST_BE_REVIEWED'
  );
});
test('service_role execute even if baseline lacks it is a blocker', () => {
  const name = REQUIRED_ADDED_FUNCTIONS[0];
  blocked(
    change((x) => {
      x.addendum['NL-GAP-02'].find(
        (r) =>
          r.function_identity.endsWith(name) && r.target_role === 'service_role'
      ).role_can_execute = true;
    }),
    'EFFECTIVE_ROLE_EXECUTE_PATH_PRESENT'
  );
});
test('privileged function owner cannot be inferred non-bypass', () => {
  blocked(
    change((x) => {
      x.addendum['NL-GAP-02'][0].owner_bypassrls = null;
    }),
    'FUNCTION_OWNER_PRIVILEGE_UNPROVEN'
  );
});
test('role absent from function metadata is not no EXECUTE', () => {
  blocked(
    change((x) => {
      x.addendum['NL-GAP-02'][0].role_found = false;
    }),
    'FUNCTION_ROLE_NOT_RESOLVED'
  );
});
test('invalid function regprocedure identity never silently joins', () => {
  blocked(
    change((x) => {
      x.addendum['NL-GAP-02'][0].function_identity = '"public"."unknown"()';
    }),
    'GAP_FUNCTION_ROLE_INVALID_KEY'
  );
});
test('base table missing trigger ACL addendum noted', () => {
  blocked(
    change((x) => {
      x.addendum['NL-GAP-03'] = x.addendum['NL-GAP-03'].filter(
        (row) => row.relation_identity !== 'public.scout_xp_ledger'
      );
    }),
    'BASE_RELATION_NOT_IN_TRIGGER_ACL_ADDENDUM'
  );
});
test('base vs new table owner mismatch is a contradiction', () => {
  blocked(
    change((x) => {
      x.base['NL-CATALOG-02'][0].table_owner = 'owner_alpha';
      x.addendum['NL-GAP-03'][0].relation_owner = 'owner_beta';
    }),
    'RELATION_OWNER_CONTRADICTION'
  );
});
test('base vs new table RLS mismatch is a contradiction', () => {
  blocked(
    change((x) => {
      x.addendum['NL-GAP-03'][0].rls_enabled = false;
    }),
    'RELATION_RLS_CONTRADICTION'
  );
});
test('base vs new table forced RLS mismatch is a contradiction', () => {
  blocked(
    change((x) => {
      x.addendum['NL-GAP-03'][0].rls_forced = false;
    }),
    'RELATION_FORCE_RLS_CONTRADICTION'
  );
});
for (const op of [
  'can_insert',
  'can_update',
  'can_delete',
  'can_truncate',
  'can_trigger'
]) {
  test('effective privilege contradictions are detected: ' + op, () => {
    blocked(
      change((x) => {
        x.addendum['NL-GAP-03'][0][op] = true;
      }),
      'RELATION_EFFECTIVE_PRIVILEGE_CONTRADICTION'
    );
  });
  test('NULL effective privilege must never become false: ' + op, () => {
    blocked(
      change((x) => {
        x.addendum['NL-GAP-03'][0][op] = null;
      }),
      'RELATION_EFFECTIVE_PRIVILEGE_UNKNOWN'
    );
  });
}
test('unknown trigger host table not treated as same scope', () => {
  blocked(
    change((x) => {
      const base = x.addendum['NL-GAP-03'][0];
      x.addendum['NL-GAP-03'].push({
        ...base,
        relation_identity: 'public.novel_comments'
      });
    }),
    'UNREVIEWED_TRIGGER_HOST_TABLE'
  );
});
test('table owner bypass flag unknown cannot be accepted', () => {
  blocked(
    change((x) => {
      x.addendum['NL-GAP-03'][0].owner_superuser = true;
    }),
    'TABLE_OWNER_PRIVILEGE_UNPROVEN'
  );
});
test('missing service_role row cannot be interpreted as revoked', () => {
  blocked(
    change((x) => {
      x.base['NL-CATALOG-05'] = x.base['NL-CATALOG-05'].filter(
        (row) => row.expected_role !== 'service_role'
      );
    }),
    'BASE_SERVICE_ROLE_CATALOG_MISSING'
  );
});
test('role catalog BYPASSRLS=true demands human review', () => {
  blocked(
    change((x) => {
      x.base['NL-CATALOG-05'][0].rolbypassrls = true;
    }),
    'SERVICE_ROLE_BYPASSRLS_MUST_BE_REVIEWED'
  );
});
test('role catalog superuser=true demands human review', () => {
  blocked(
    change((x) => {
      x.base['NL-CATALOG-05'][0].rolsuper = true;
    }),
    'SERVICE_ROLE_SUPERUSER_MUST_BE_REVIEWED'
  );
});
test('same snapshot cannot be proven with independent SQL fixtures', () => {
  blocked(
    reviewTwoCatalogEvidence(input()),
    'BOTH_SQL_RESULTS_SAME_SNAPSHOT_NOT_PROVEN'
  );
});
test('two digest bundle ID is domain-separated and deterministic', () => {
  const a = computeProposedBundleDigest(),
    b = computeProposedBundleDigest();
  assert.equal(a, b);
  assert.match(a, /^[a-f0-9]{64}$/u);
  assert.notEqual(a, BUNDLE_SQL_HASHES.base);
  assert.notEqual(a, BUNDLE_SQL_HASHES.addendum);
  assert.notEqual(
    computeProposedBundleDigest({
      base: BUNDLE_SQL_HASHES.addendum,
      addendum: BUNDLE_SQL_HASHES.base
    }),
    a
  );
});
test('new bundle scope must differ from old read-only scope', () => {
  assert.notEqual(PROPOSED_BUNDLE_SCOPE, PROPOSED_CATALOG_SCOPE);
  assert.match(PROPOSED_BUNDLE_SCOPE, /catalog-bundle-readonly$/u);
  assert.equal(BUNDLE_REVIEW_STEPS.length, 12);
  assert.ok(Object.isFrozen(BUNDLE_REVIEW_STEPS));
});
test('perfect-looking bundle request is always unapproved', () => {
  const r = reviewTrustedMainCatalogBundleContract(request());
  assert.equal(r.status, 'HOLD_UNAPPROVED_BUNDLE_CONTRACT');
  assert.equal(r.freshScopedApprovalIssued, false);
  assert.equal(r.actualOneShotOwnerClaim, false);
  assert.equal(r.existingOwnerScopesReusable, false);
  assert.equal(r.reviewDomain, MUTATION_DOMAIN);
  assert.equal(r.requiredTrustedMainSequence.length, 12);
  safe(r);
});
for (const [name, delta, code] of [
  [
    'old scope',
    { scope: PROPOSED_CATALOG_SCOPE },
    'NEW_INDEPENDENT_BUNDLE_SCOPE_REQUIRED'
  ],
  [
    'old atomic scope',
    { scope: 'reader-reward-beta-point-10x-staging' },
    'NEW_INDEPENDENT_BUNDLE_SCOPE_REQUIRED'
  ],
  ['wrong issue', { issueNumber: 295 }, 'OWNER_ISSUE_294_REQUIRED'],
  [
    'write operation',
    { operation: 'persist' },
    'BUNDLE_READONLY_OPERATION_REQUIRED'
  ],
  [
    'production',
    { stagingRef: PRODUCTION_PROJECT },
    'EXACT_STAGING_PROJECT_IDENTITY_REQUIRED'
  ],
  ['stale head', { headSha: 'stale' }, 'BUNDLE_MAIN_AND_PR_HEAD_REQUIRED'],
  ['stale main', { mainSha: 'bad' }, 'BUNDLE_MAIN_AND_PR_HEAD_REQUIRED'],
  [
    'wrong SQL bundle',
    { sqlDigests: { base: 'f'.repeat(64), addendum: 'x' } },
    'TWO_PINNED_SQL_DIGESTS_REQUIRED'
  ],
  [
    'reversed digest',
    { bundleDigest: 'f'.repeat(64) },
    'CANONICAL_BUNDLE_DIGEST_REQUIRED'
  ],
  ['no comment', { commentId: 0 }, 'UNSPENT_UNIQUE_OWNER_COMMENT_REQUIRED'],
  [
    'spoof owner',
    { ownerProof: { approved: true } },
    'CALLER_ASSERTED_AUTHORITY_UNTRUSTED'
  ],
  ['spoof consumed', { claimed: true }, 'CALLER_ASSERTED_AUTHORITY_UNTRUSTED']
]) {
  test('read-only bundle OWNER gate denies ' + name, () => {
    blocked(
      reviewTrustedMainCatalogBundleContract({ ...request(), ...delta }),
      code
    );
  });
}
test('non-object approval request is always HOLD', () => {
  blocked(
    reviewTrustedMainCatalogBundleContract(null),
    'BUNDLE_REQUEST_MUST_BE_RECORD'
  );
});
test('new model ledger has common mutation domain and no spent approvals', () => {
  const x = newOfflineBundleClaimState();
  assert.equal(x.domain, MUTATION_DOMAIN);
  assert.equal(x.version, 0);
  assert.equal(x.epoch, 0);
  assert.deepEqual(x.spentIds, []);
  assert.ok(Object.isFrozen(x));
});
const cas = (state, delta = {}, options = {}) =>
  simulateBundleOneShotCas({
    state,
    request: { ...request(), ...delta },
    expectedVersion: state.version,
    expectedEpoch: state.epoch,
    ...options
  });
test('one-shot fake success is spent only in model, never actually claimed', () => {
  const before = newOfflineBundleClaimState();
  const result = cas(before);
  assert.equal(result.status, 'MODEL_BUNDLE_CAS_SPENT_NOT_REAL');
  assert.deepEqual(result.syntheticStateOnly.spentIds, [91357]);
  assert.equal(result.syntheticStateOnly.epoch, 1);
  assert.equal(result.syntheticStateOnly.version, 1);
  assert.equal(before.epoch, 0);
  safe(result);
});
test('spent comment reused is rejected', () => {
  const first = cas(newOfflineBundleClaimState());
  blocked(
    cas(first.syntheticStateOnly),
    'OWNER_COMMENT_ALREADY_SPENT_NO_REPLAY'
  );
});
test('shared mutation domain cannot be preempted by fresh comment', () => {
  const first = cas(newOfflineBundleClaimState());
  blocked(
    cas(first.syntheticStateOnly, { commentId: 91358 }),
    'SHARED_MUTATION_DOMAIN_ALREADY_OCCUPIED'
  );
});
test('CAS expected version and epoch are both compared', () => {
  const state = newOfflineBundleClaimState();
  blocked(
    simulateBundleOneShotCas({
      state,
      request: request(),
      expectedVersion: 1,
      expectedEpoch: 0
    }),
    'CAS_EXPECTED_VERSION_OR_EPOCH_STALE'
  );
  blocked(
    simulateBundleOneShotCas({
      state,
      request: request(),
      expectedVersion: 0,
      expectedEpoch: 1
    }),
    'CAS_EXPECTED_VERSION_OR_EPOCH_STALE'
  );
});
for (const ack of ['lost', 'unknown']) {
  test('lost COMMIT acknowledgement is HOLD without any replay: ' + ack, () => {
    const one = cas(newOfflineBundleClaimState(), {}, { ack });
    assert.equal(one.status, 'HOLD_UNKNOWN_COMMIT_ACK_NO_RETRY');
    assert.equal(one.syntheticStateOnly.commitAckUnknown, true);
    assert.equal(one.noAutomaticReplay, true);
    assert.equal(one.noAutomaticRelease, true);
    safe(one);
    blocked(
      cas(one.syntheticStateOnly, { commentId: 91359 }),
      'UNCERTAIN_COMMIT_REQUIRES_AUTHORITATIVE_READBACK'
    );
  });
}
test('wrong ACK format cannot mint model success', () => {
  blocked(
    cas(
      newOfflineBundleClaimState(),
      {},
      { ack: 'real_transaction_confirmed' }
    ),
    'COMMIT_ACK_STATUS_INVALID'
  );
});
test('old scope and production target cannot mint model success', () => {
  blocked(
    cas(newOfflineBundleClaimState(), {
      scope: PROPOSED_CATALOG_SCOPE
    }),
    'BUNDLE_TARGET_CONTRACT_REJECTED'
  );
  blocked(
    cas(newOfflineBundleClaimState(), {
      stagingRef: PRODUCTION_PROJECT
    }),
    'BUNDLE_TARGET_CONTRACT_REJECTED'
  );
});
test('fake OWNER authorization input cannot mint a model spent record', () => {
  blocked(
    cas(newOfflineBundleClaimState(), {
      ownerProof: { owner: true }
    }),
    'BUNDLE_TARGET_CONTRACT_REJECTED'
  );
});
test('invalid ledger never authorizes a read', () => {
  blocked(
    simulateBundleOneShotCas({
      state: {},
      request: request(),
      expectedVersion: 0,
      expectedEpoch: 0
    }),
    'CAS_STATE_INVALID'
  );
});
test('trigger namespace cannot be silently assumed public', () => {
  blocked(
    change((x) => {
      x.addendum['NL-GAP-01'][0].table_schema = 'private';
    }),
    'TRIGGER_SCHEMA_NOT_PUBLIC_OR_UNKNOWN'
  );
});
test('trigger owner must match function registry owner', () => {
  blocked(
    change((x) => {
      x.addendum['NL-GAP-01'][0].function_owner = 'other_owner';
    }),
    'TRIGGER_FUNCTION_OWNER_CONTRADICTION'
  );
});
test('trigger SECDEF flag must match dynamic function registry', () => {
  blocked(
    change((x) => {
      x.addendum['NL-GAP-01'][0].is_security_definer = true;
    }),
    'TRIGGER_FUNCTION_SECDEF_CONTRADICTION'
  );
});
test('trigger service_role EXECUTE must match dynamic function registry', () => {
  blocked(
    change((x) => {
      x.addendum['NL-GAP-01'][0].service_role_can_execute = true;
    }),
    'TRIGGER_FUNCTION_EXECUTE_CONTRADICTION'
  );
});
test('trigger search path must match dynamic function registry', () => {
  blocked(
    change((x) => {
      x.addendum['NL-GAP-01'][0].function_has_fixed_search_path = false;
    }),
    'TRIGGER_FUNCTION_SEARCH_PATH_CONTRADICTION'
  );
});
test('trigger owner bypass must match function registry', () => {
  blocked(
    change((x) => {
      x.addendum['NL-GAP-01'][0].owner_bypassrls = true;
    }),
    'TRIGGER_FUNCTION_OWNER_BYPASS_CONTRADICTION'
  );
});
test('trigger owner superuser flag must match function registry', () => {
  blocked(
    change((x) => {
      x.addendum['NL-GAP-01'][0].owner_superuser = true;
    }),
    'TRIGGER_FUNCTION_OWNER_SUPERUSER_CONTRADICTION'
  );
});
test('unknown trigger function must not be treated as a reviewed registry function', () => {
  blocked(
    change((x) => {
      x.addendum['NL-GAP-01'][0].invoked_function_identity =
        'public.novelight_future_unregistered_scout_writer()';
    }),
    'TRIGGER_FUNCTION_MISSING_FROM_PRIVILEGED_REGISTRY'
  );
});
test('trigger host in another schema is a separate unverified permission domain', () => {
  blocked(
    change((x) => {
      x.addendum['NL-GAP-03'][0].relation_identity = 'other.scout_xp_ledger';
    }),
    'TRIGGER_HOST_SCHEMA_NOT_PUBLIC_OR_UNKNOWN'
  );
});
test('approval bundle must contain exactly two digests', () => {
  blocked(
    reviewTrustedMainCatalogBundleContract({
      ...request(),
      sqlDigests: { ...digests(), third: 'fake' }
    }),
    'TWO_PINNED_SQL_DIGESTS_REQUIRED'
  );
});

test('offline reconciler cannot access SQL engine, network, Docker or owner API', () => {
  const code = readFileSync(
    fileURLToPath(
      new URL(
        '../scripts/scout-point10x-catalog-evidence-union.mjs',
        import.meta.url
      )
    ),
    'utf8'
  );
  assert.doesNotMatch(code, /spawnSync\s*\(/u);
  assert.doesNotMatch(code, /createClient\s*\(/u);
  assert.doesNotMatch(code, /execute_sql\s*\(/u);
  assert.doesNotMatch(code, /https?:\/\//u);
  assert.match(code, /mayRunSql:\s*false/u);
  assert.match(code, /mayClaimOwner:\s*false/u);
});
