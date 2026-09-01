import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(path, 'utf8');

test('external recovery reconciles current state before remediation', async () => {
  const gate = await read('docs/EVIDENCE-FRESHNESS-GATE.md');

  const patterns = [
    /## 3\.5 Current-State Reconciliation Gate before retry or remediation/,
    /historical failure proves only that the operation failed at that time/i,
    /Production, Staging, Preview\/Test/,
    /`satisfied`/,
    /`action-required`/,
    /`unknown`/,
    /before asking the user to create\/replace a Secret, reset a password/,
    /### Staging migration recovery rule/,
    /STAGING_DATABASE_URL is not configured/,
    /exact target migration is already applied/,
    /Do not ask for `STAGING_DATABASE_URL`, database-password reset, or a duplicate migration-sync request/,
    /current external state → need for remediation → remediation/,
    /historical external-operation failure alone cannot justify retry\/remediation/,
    /`unknown` current target state fails closed/
  ];

  for (const pattern of patterns) {
    assert.match(gate, pattern);
  }
});
