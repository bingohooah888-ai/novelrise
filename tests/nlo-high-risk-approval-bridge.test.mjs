import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const bridgeCorePath = 'tools/novelight-commander/src/github-bridge-core.js';
const bridgeCore = await readFile(bridgeCorePath, 'utf8');

test('NLO high-risk approval is fixed and owner scoped', () => {
  assert.match(bridgeCore, /high_risk_pr_approve/);
  assert.match(bridgeCore, /CHAT_PRODUCTION_APPROVED/);
  assert.match(bridgeCore, /NOVELIGHT_HIGH_RISK_APPROVE/);
  assert.match(bridgeCore, /pull\?\.base\?\.ref !== 'main'/);
  assert.match(bridgeCore, /author_association === 'OWNER'/);
  assert.match(bridgeCore, /identity\.stdout\.trim\(\) !== OWNER/);
  assert.match(bridgeCore, /'gh', \['api', 'user'/);
  assert.match(bridgeCore, /highRiskApprovalChallenge\(pr, headSha\)/);
  assert.doesNotMatch(bridgeCore, /request\.args\.body/);
  assert.doesNotMatch(bridgeCore, /request\.args\.comment/);
});
