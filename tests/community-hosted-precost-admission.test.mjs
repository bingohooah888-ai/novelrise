import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HOSTED_PRE_COST_APPROVE,
  verifyCommunityHostedPreCostAdmission
} from '../scripts/community-hosted-precost-admission.mjs';
import {
  HOSTED_APPROVE,
  HOSTED_CLAIMED,
  HOSTED_CONSUMED,
  HOSTED_SCOPE
} from '../scripts/community-hosted-write-admission.mjs';

const MAIN = 'a'.repeat(40);
const FEATURE = '6bf0ea608183e4977fcdaa17d36b1712974d5a49';
const RUN = '456';
const proposal = {
  scope: HOSTED_SCOPE,
  mainSha: MAIN,
  featureSha: FEATURE,
  target: 'new-data-less-isolated-branch',
  confirmation: 'STAGING COST APPROVED'
};

function fixture() {
  return {
    event: {
      action: 'created',
      repository: { full_name: 'bingohooah888-ai/novelrise' },
      issue: {
        number: 188,
        title: '[Staging Approval Control] Preview / Staging cost gate',
        user: { login: 'bingohooah888-ai' }
      },
      comment: {
        id: 123,
        user: { login: 'bingohooah888-ai' },
        author_association: 'OWNER',
        body: HOSTED_PRE_COST_APPROVE + JSON.stringify(proposal)
      }
    },
    main: { object: { sha: MAIN } },
    feature: {
      number: 2222,
      state: 'open',
      draft: true,
      merged: false,
      base: { ref: 'main' },
      head: {
        sha: FEATURE,
        repo: { full_name: 'bingohooah888-ai/novelrise' }
      }
    },
    ledgerPages: [[]],
    runId: RUN
  };
}

function denied(change) {
  const x = fixture();
  change(x);
  assert.throws(
    () => verifyCommunityHostedPreCostAdmission(x),
    /COMMUNITY_HOSTED_PRE_COST_DENIED/u
  );
}

test(
  'owner intent is strictly preparation-only and cannot initiate costs',
  () => {
    const proof = verifyCommunityHostedPreCostAdmission(fixture());
    assert.equal(proof.status, 'OWNER_PRE_COST_PROPOSAL_PREPARATION_ONLY');
    assert.equal(proof.mainSha, MAIN);
    assert.equal(proof.candidateSha, FEATURE);
    assert.equal(proof.plannedBranchName, 'community-hosted-' + RUN);
    assert.equal(proof.requestCommentId, '123');
    assert.equal(proof.liveEvidenceVerified, false);
    for (const key of [
      'stagingCostApproved',
      'mayClaim',
      'mayCreateBranch',
      'mayDeployPreview',
      'mayRunBrowser',
      'runAuthorized',
      'releaseAuthorized'
    ]) {
      assert.equal(proof[key], false, key);
    }
    assert.ok(Object.isFrozen(proof));
  }
);

test(
  'only exact GitHub owner-authored Issue #188 event can be inspected',
  () => {
    denied((x) => {
      x.event.action = 'edited';
    });
    denied((x) => {
      x.event.repository.full_name = 'someone/novelrise';
    });
    denied((x) => {
      x.event.issue.number = 294;
    });
    denied((x) => {
      x.event.issue.title = 'different';
    });
    denied((x) => {
      x.event.issue.user.login = 'attacker';
    });
    denied((x) => {
      x.event.issue.pull_request = {};
    });
    denied((x) => {
      x.event.comment.user.login = 'attacker';
    });
    denied((x) => {
      x.event.comment.author_association = 'MEMBER';
    });
    denied((x) => {
      x.event.comment.id = 0;
    });
    denied((x) => {
      x.runId = '0';
    });
    denied((x) => {
      x.runId = '456; evil';
    });
  }
);

test('fresh exact main, untouched Draft head and scope are mandatory', () => {
  denied((x) => {
    x.main.object.sha = 'b'.repeat(40);
  });
  denied((x) => {
    x.feature.head.sha = 'c'.repeat(40);
  });
  denied((x) => {
    x.feature.head.repo.full_name = 'different/repo';
  });
  denied((x) => {
    x.feature.draft = false;
  });
  denied((x) => {
    x.feature.merged = true;
  });
  denied((x) => {
    x.feature.state = 'closed';
  });
  denied((x) => {
    x.feature.base.ref = 'not-main';
  });
  denied((x) => {
    x.feature.number = 123;
  });
  denied((x) => {
    x.event.comment.body = HOSTED_PRE_COST_APPROVE + JSON.stringify({
      ...proposal,
      scope: 'migration-sync'
    });
  });
  denied((x) => {
    x.event.comment.body = HOSTED_PRE_COST_APPROVE + JSON.stringify({
      ...proposal,
      mainSha: 'not-a-sha'
    });
  });
  denied((x) => {
    x.event.comment.body = HOSTED_PRE_COST_APPROVE + JSON.stringify({
      ...proposal,
      target: 'shared-staging'
    });
  });
});

test(
  'read-only preflight, hosted post-provision and extra fields cannot be used',
  () => {
    denied((x) => {
      x.event.comment.body = HOSTED_APPROVE + JSON.stringify(proposal);
    });
    denied((x) => {
      x.event.comment.body = HOSTED_PRE_COST_APPROVE + JSON.stringify({
        ...proposal,
        confirmation: 'PREFLIGHT ONLY'
      });
    });
    denied((x) => {
      x.event.comment.body = HOSTED_PRE_COST_APPROVE + JSON.stringify({
        ...proposal,
        command: 'create-branch'
      });
    });
    denied((x) => {
      x.event.comment.body = HOSTED_PRE_COST_APPROVE + '{';
    });
  }
);

test('claimed, consumed and reused workflow runs are rejected', () => {
  for (const marker of [HOSTED_CLAIMED, HOSTED_CONSUMED]) {
    const row = {
      requestCommentId: '123',
      mainSha: MAIN,
      featureSha: FEATURE,
      runId: '77',
      ...(marker === HOSTED_CONSUMED ? { result: 'failure' } : {})
    };
    denied((x) => {
      x.ledgerPages = [[{ body: marker + JSON.stringify(row) }]];
    });
    denied((x) => {
      x.ledgerPages = [
        [
          {
            body: marker + JSON.stringify({
              ...row,
              requestCommentId: '999',
              runId: RUN
            })
          }
        ]
      ];
    });
  }
});

test('malformed, truncated and ambiguous control ledger fails closed', () => {
  denied((x) => {
    x.ledgerPages = [];
  });
  denied((x) => {
    x.ledgerPages = [Array(100).fill({ body: '' })];
  });
  denied((x) => {
    x.ledgerPages = Array.from({ length: 21 }, () => []);
  });
  denied((x) => {
    x.ledgerPages = [[null]];
  });
  denied((x) => {
    x.ledgerPages = [[{ body: HOSTED_CLAIMED + '{' }]];
  });
  denied((x) => {
    x.ledgerPages = [
      [
        {
          body: HOSTED_CLAIMED + JSON.stringify({
            requestCommentId: '123',
            mainSha: MAIN,
            featureSha: FEATURE,
            runId: 'invalid'
          })
        }
      ]
    ];
  });
  denied((x) => {
    x.ledgerPages = [
      [
        {
          body: HOSTED_CONSUMED + JSON.stringify({
            requestCommentId: '999',
            mainSha: MAIN,
            featureSha: FEATURE,
            runId: '888',
            result: ''
          })
        }
      ]
    ];
  });
});
