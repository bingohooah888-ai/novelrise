import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

import {
  inspectCommunityHostedReservationProtection
} from '../scripts/community-hosted-reservation-protection.mjs';

const REPO = 'bingohooah888-ai/novelrise';
const MATCH = 'refs/tags/novelight-community-hosted-once-v1-*';

function rule() {
  return {
    id: 412,
    name: 'Community one-use claim reservation tags',
    source: REPO,
    source_type: 'Repository',
    target: 'tag',
    enforcement: 'active',
    current_user_can_bypass: 'never',
    bypass_actors: [],
    conditions: {
      ref_name: {
        include: [MATCH],
        exclude: []
      }
    },
    rules: [{ type: 'deletion' }, { type: 'update' }]
  };
}

function input() {
  const detail = rule();
  return {
    repository: REPO,
    inventoryPages: [[{
      id: detail.id,
      source_type: detail.source_type,
      target: detail.target,
      enforcement: detail.enforcement
    }]],
    tagRuleDetails: [detail]
  };
}

function denies(mutator) {
  const x = input();
  mutator(x);
  assert.throws(
    () => inspectCommunityHostedReservationProtection(x),
    /COMMUNITY_HOSTED_REF_PROTECTION_DENIED/u
  );
}

test('matching active non-bypassable tag rule is read-only evidence only', () => {
  const x = inspectCommunityHostedReservationProtection(input());
  assert.equal(x.status, 'RESERVATION_TAG_RULESET_READ_ONLY_INSPECTION');
  assert.deepEqual(x.matchingRulesetIds, [412]);
  assert.equal(x.protectionObserved, true);
  assert.equal(x.protectionFreshAtExecution, false);
  for (const name of [
    'atomicClaimVerified',
    'stagingCostApproved',
    'mayClaim',
    'mayCreateBranch',
    'mayDeployPreview',
    'mayRunBrowser',
    'runAuthorized',
    'writeAuthorized',
    'releaseAuthorized'
  ]) {
    assert.equal(x[name], false);
  }
  assert.ok(Object.isFrozen(x));
  assert.ok(Object.isFrozen(x.matchingRulesetIds));
});

test('current actual main branch rule does not protect one-use tags', () => {
  const x = input();
  x.inventoryPages = [[{
    id: 21196358,
    target: 'branch',
    enforcement: 'active',
    source_type: 'Repository'
  }]];
  x.tagRuleDetails = [];
  assert.throws(
    () => inspectCommunityHostedReservationProtection(x),
    /COMMUNITY_HOSTED_REF_PROTECTION_DENIED/u
  );
});

test('disabled, evaluation-only, branch and bypassable rules deny', () => {
  denies((x) => {
    x.tagRuleDetails[0].enforcement = 'evaluate';
  });
  denies((x) => {
    x.tagRuleDetails[0].target = 'branch';
  });
  denies((x) => {
    x.tagRuleDetails[0].source_type = 'Organization';
  });
  denies((x) => {
    x.tagRuleDetails[0].source = 'other/repo';
  });
  denies((x) => {
    x.tagRuleDetails[0].current_user_can_bypass = 'always';
  });
  denies((x) => {
    x.tagRuleDetails[0].bypass_actors = [{
      actor_type: 'RepositoryRole',
      actor_id: 5,
      bypass_mode: 'always'
    }];
  });
});

test('unprotected deletion or mutation is always denied', () => {
  denies((x) => {
    x.tagRuleDetails[0].rules = [{ type: 'update' }];
  });
  denies((x) => {
    x.tagRuleDetails[0].rules = [{ type: 'deletion' }];
  });
  denies((x) => {
    x.tagRuleDetails[0].rules = [];
  });
  denies((x) => {
    x.tagRuleDetails[0].conditions.ref_name.exclude = ['refs/tags/*'];
  });
  denies((x) => {
    x.tagRuleDetails[0].conditions.ref_name.include = [
      'refs/tags/unrelated-*'
    ];
  });
  denies((x) => {
    x.tagRuleDetails[0].conditions.ref_name.include = [];
  });
});

test('repository wildcard tag protection is acceptable without exclusions', () => {
  for (const include of ['refs/tags/*', '~ALL']) {
    const x = input();
    x.tagRuleDetails[0].conditions.ref_name.include = [include];
    const result = inspectCommunityHostedReservationProtection(x);
    assert.deepEqual(result.matchingRulesetIds, [412]);
  }
});

test('incomplete, malformed or duplicated ruleset inventory denies', () => {
  denies((x) => {
    x.inventoryPages = [];
  });
  denies((x) => {
    x.inventoryPages = [[]];
  });
  denies((x) => {
    x.inventoryPages.push([]);
  });
  denies((x) => {
    x.inventoryPages = [Array(100).fill(x.inventoryPages[0][0])];
  });
  denies((x) => {
    x.inventoryPages[0].push({ ...x.inventoryPages[0][0] });
  });
  denies((x) => {
    x.inventoryPages[0][0].id = 0;
  });
  denies((x) => {
    x.inventoryPages[0][0].target = 'unknown';
  });
});

test('all active tag rules must have trustworthy matching details', () => {
  denies((x) => {
    x.tagRuleDetails = [];
  });
  denies((x) => {
    x.tagRuleDetails[0].id = 999;
  });
  denies((x) => {
    x.tagRuleDetails.push({ ...x.tagRuleDetails[0] });
  });
  denies((x) => {
    x.inventoryPages[0].push({
      id: 413,
      target: 'tag',
      enforcement: 'active',
      source_type: 'Repository'
    });
  });
});

test('caller cannot redirect policy inspector to a different repository', () => {
  denies((x) => {
    x.repository = 'attacker/repo';
  });
});

test('OWNER read-only pre-cost workflow must inspect reservation tag protection', () => {
  const path = new URL(
    '../.github/workflows/community-hosted-precost-inspection.yml',
    import.meta.url
  );
  const workflow = readFileSync(path, 'utf8');
  for (const required of [
    'issue_comment:',
    'persist-credentials: false',
    'contents: read',
    'issues: read',
    'pull-requests: read',
    'rulesets?includes_parents=true&per_page=100',
    'community-hosted-reservation-protection.mjs validate',
    '.mayClaim == false',
    '.stagingCostApproved == false'
  ]) {
    assert.ok(workflow.includes(required), required);
  }
  for (const forbidden of [
    'issues: write',
    'contents: write',
    'environment: staging',
    'gh api -X',
    'api.supabase.com',
    'secrets.',
    'workflow_dispatch',
    'npx vercel'
  ]) {
    assert.ok(!workflow.includes(forbidden), forbidden);
  }
});
