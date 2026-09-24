import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const daemonPath = 'tools/novelight-commander/src/github-bridge-daemon.js';
const daemon = await readFile(daemonPath, 'utf8');

test('NLO high-risk approval is fixed and owner scoped', () => {
  assert.match(daemon, /high_risk_pr_approve/);
  assert.match(daemon, /CHAT_PRODUCTION_APPROVED/);
  assert.match(daemon, /NOVELIGHT_HIGH_RISK_APPROVE/);
  assert.match(daemon, /pull\?\.base\?\.ref !== 'main'/);
  assert.match(daemon, /author_association === 'OWNER'/);
  assert.match(daemon, /highRiskApprovalChallenge\(pr, headSha\)/);
  assert.doesNotMatch(daemon, /request\.args\.body/);
  assert.doesNotMatch(daemon, /request\.args\.comment/);
});
