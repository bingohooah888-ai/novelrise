import assert from 'node:assert/strict';
import test from 'node:test';

import { assessAiConsentStagingParity } from '../scripts/ai-consent-staging-parity-gate.mjs';

const PROD = 'fiepaguycecrredwrcwx';
const STAGE = 'wmlzjgvxgoyrovdhbqbg';

const M = {
  BASE: '20261027120000',
  REVIEW: '20261028084410',
  COMMENT: '20261030010000'
};

test('observed Staging review-only migration drift is blocked and disclosed', () => {
  const status = assessAiConsentStagingParity({
    stagingRef: STAGE,
    productionRef: PROD,
    local: [M.BASE, M.COMMENT],
    staging: [M.BASE, M.REVIEW],
    production: [M.BASE, M.COMMENT]
  });
  assert.equal(status.ready, false);
  assert.equal(status.reason, 'MIGRATION_LEDGER_DRIFT');
  assert.deepEqual(status.parity.staging.extra, [M.REVIEW]);
  assert.deepEqual(status.parity.staging.missing, [M.COMMENT]);
  assert.deepEqual(status.parity.production.extra, []);
  assert.deepEqual(status.parity.production.missing, []);
});

test('identical current ledgers permit future preflight but no DB mutation', () => {
  const status = assessAiConsentStagingParity({
    stagingRef: STAGE,
    productionRef: PROD,
    local: [M.BASE, M.REVIEW, M.COMMENT],
    staging: [M.BASE, M.REVIEW, M.COMMENT],
    production: [M.BASE, M.REVIEW, M.COMMENT]
  });
  assert.equal(status.ready, true);
  assert.equal(status.reason, 'LEDGER_PARITY_OK');
});

test('production-as-staging or unknown project refs fail closed', () => {
  for (const input of [
    { stagingRef: PROD, productionRef: PROD },
    { stagingRef: 'unknown', productionRef: PROD },
    { stagingRef: STAGE, productionRef: STAGE },
    { stagingRef: STAGE, productionRef: 'unknown' }
  ]) {
    const status = assessAiConsentStagingParity({
      ...input,
      local: [M.BASE],
      staging: [M.BASE],
      production: [M.BASE]
    });
    assert.equal(status.ready, false);
    assert.equal(status.reason, 'STAGING_TARGET_UNVERIFIED');
  }
});

test('duplicate or malformed version lists are not treated as parity', () => {
  for (const input of [
    { local: [M.BASE, M.BASE] },
    { staging: ['wrong-version'] },
    { production: [] }
  ]) {
    const status = () =>
      assessAiConsentStagingParity({
        stagingRef: STAGE,
        productionRef: PROD,
        local: [M.BASE],
        staging: [M.BASE],
        production: [M.BASE],
        ...input
      });
    if (input.production) {
      assert.equal(status().ready, false);
    } else {
      assert.throws(status, /INVALID_MIGRATION_LEDGER/u);
    }
  }
});
