import assert from 'node:assert/strict';
import test from 'node:test';

import { summarizeCommunityHostedCost } from '../scripts/community-hosted-cost-report.mjs';

function fixture() {
  return {
    runId: '456',
    startedAt: '2026-10-22T01:00:00.000Z',
    deletedAt: '2026-10-22T03:00:00.000Z',
    branchDeletionVerified: true,
    supabaseHourlyUsd: 0.01344,
    supabaseInvoice: { provider: 'supabase', status: 'pending' },
    vercelInvoice: { provider: 'vercel', status: 'pending' }
  };
}

test('branch quote is not confused with a provider invoice', () => {
  const output = summarizeCommunityHostedCost(fixture());
  assert.equal(output.supabaseQuotedComputeUsd, '0.026880');
  assert.equal(output.totalFinalUsd, null);
  assert.equal(output.estimateIsNotAnInvoice, true);
});

test('actual total needs both final provider receipts and deleted branch', () => {
  const input = fixture();
  input.supabaseInvoice = {
    provider: 'supabase',
    status: 'final',
    source: 'provider-finalized-statement',
    currency: 'USD',
    amountMicros: 26880,
    reference: 'supabase-123456'
  };
  input.vercelInvoice = {
    provider: 'vercel',
    status: 'final',
    source: 'provider-finalized-statement',
    currency: 'USD',
    amountMicros: 100000,
    reference: 'vercel-123456'
  };
  const proof = summarizeCommunityHostedCost(input);
  assert.equal(proof.totalFinalUsd, '0.126880');
  input.branchDeletionVerified = false;
  assert.equal(summarizeCommunityHostedCost(input).totalFinalUsd, null);
});

test('time and billing uncertainty never produce false final totals', () => {
  const input = fixture();
  input.deletedAt = null;
  assert.equal(
    summarizeCommunityHostedCost(input).supabaseQuotedComputeUsd,
    null
  );
  input.deletedAt = '2026-10-22T03:00:00.000Z';
  input.supabaseInvoice = {
    provider: 'supabase',
    status: 'final',
    source: 'provider-finalized-statement',
    currency: 'USD',
    amountMicros: 0,
    reference: 'supabase-123456'
  };
  assert.equal(summarizeCommunityHostedCost(input).totalFinalUsd, null);
});

test('bad provenance, mixed currencies, negative rates and impossible times denied', () => {
  const mutations = [
    (x) => {
      x.deletedAt = '2026-10-20T01:00:00.000Z';
    },
    (x) => {
      x.runId = '0';
    },
    (x) => {
      x.branchDeletionVerified = 'yes';
    },
    (x) => {
      x.supabaseHourlyUsd = -1;
    },
    (x) => {
      x.vercelInvoice = {
        provider: 'vercel',
        status: 'pending',
        amountMicros: 0
      };
    },
    (x) => {
      x.vercelInvoice = {
        provider: 'vercel',
        status: 'final',
        source: 'provider-finalized-statement',
        currency: 'JPY',
        amountMicros: 99999,
        reference: 'vercel-123456'
      };
    }
  ];
  for (const mutate of mutations) {
    const input = fixture();
    mutate(input);
    assert.throws(
      () => summarizeCommunityHostedCost(input),
      /COMMUNITY_HOSTED_COST_REPORT_DENIED/u
    );
  }
});
