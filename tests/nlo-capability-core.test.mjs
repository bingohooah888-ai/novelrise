import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyRequestedEffects,
  findCapability,
  mergeGapRecord,
  normalizeIntent,
  resolveCapability,
  validateRegistry
} from '../scripts/nlo-capability-core.mjs';

const registry = {
  schemaVersion: 1,
  policyVersion: '1.0',
  capabilities: [
    {
      id: 'nlo.capability.resolve',
      description: 'Resolve registered capabilities and surface reusable gaps.',
      intents: ['resolve capability', 'capability gap'],
      aliases: ['missing nlo capability'],
      adapter: 'scripts/nlo-capability-core.mjs',
      executionRisk: 'A',
      requiredPermissions: ['repo_read'],
      testCommands: ['node --test tests/nlo-capability-core.test.mjs'],
      version: '1.0.0',
      status: 'enabled',
      provenance: 'repo'
    }
  ]
};

test('normalizes intent without erasing Japanese text', () => {
  assert.equal(normalizeIntent('  小説＿本文   取得  '), '小説 本文 取得');
});

test('classifies low-risk read-only effects as tier A', () => {
  assert.equal(classifyRequestedEffects(['repo_read', 'static analysis']), 'A');
});

test('classifies code writes as tier B', () => {
  assert.equal(classifyRequestedEffects(['repo_write', 'create helper']), 'B');
});

test('classifies security and production effects as tier C', () => {
  assert.equal(classifyRequestedEffects(['production deploy']), 'C');
  assert.equal(classifyRequestedEffects(['RLS permission change']), 'C');
});

test('validates registry and resolves enabled capability', () => {
  assert.deepEqual(validateRegistry(registry), []);
  assert.equal(
    findCapability(registry, 'missing nlo capability')?.id,
    'nlo.capability.resolve'
  );
  const result = resolveCapability(registry, {
    intent: 'resolve capability',
    effects: ['repo_read']
  });
  assert.equal(result.status, 'available');
  assert.equal(result.capability.id, 'nlo.capability.resolve');
});

test('missing capability becomes a gap instead of unsupported terminal state', () => {
  const result = resolveCapability(registry, {
    intent: 'read a new fiction provider',
    effects: ['network read', 'local cache write']
  });
  assert.equal(result.status, 'capability_gap');
  assert.equal(result.gap.executionRisk, 'A');
  assert.equal(
    result.gap.nextAction,
    'build_reusable_capability_on_work_branch_then_retry_original_request'
  );
});

test('gap records deduplicate and count repeated needs', () => {
  const gap = resolveCapability(registry, {
    intent: 'new parser',
    effects: ['repo_read']
  }).gap;
  const first = mergeGapRecord(null, gap, '2026-10-01T00:00:00.000Z');
  const second = mergeGapRecord(first, gap, '2026-10-01T01:00:00.000Z');
  assert.equal(second.gaps.length, 1);
  assert.equal(second.gaps[0].count, 2);
  assert.equal(second.gaps[0].firstSeenAt, '2026-10-01T00:00:00.000Z');
  assert.equal(second.gaps[0].lastSeenAt, '2026-10-01T01:00:00.000Z');
});
