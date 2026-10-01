import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAdminAlerts,
  buildMetricComparisons,
  normalizeAdminRange,
  percentDelta
} from '../api/_lib/admin-metrics.js';

test('normalizeAdminRange only accepts supported dashboard ranges', () => {
  assert.equal(normalizeAdminRange('7'), '7');
  assert.equal(normalizeAdminRange('30'), '30');
  assert.equal(normalizeAdminRange('90'), '90');
  assert.equal(normalizeAdminRange('all'), 'all');
  assert.equal(normalizeAdminRange('365'), '30');
});

test('percentDelta handles a zero baseline without inventing growth', () => {
  assert.equal(percentDelta(12, 10), 20);
  assert.equal(percentDelta(8, 10), -20);
  assert.equal(percentDelta(8, 0), null);
});

test('metric comparisons calculate previous-day and prior average deltas', () => {
  const rows = [
    { metric_date: '2026-09-28', unique_visitors: 10 },
    { metric_date: '2026-09-29', unique_visitors: 20 },
    { metric_date: '2026-09-30', unique_visitors: 30 }
  ];
  const result = buildMetricComparisons(rows, ['unique_visitors']);
  assert.equal(result.unique_visitors.previousDayPct, 50);
  assert.equal(result.unique_visitors.sevenDayAverage, 15);
  assert.equal(result.unique_visitors.sevenDayAveragePct, 100);
});

test('admin alerts notify only and surface operational thresholds', () => {
  const rows = [
    { metric_date: '2026-09-22', unique_visitors: 100, new_users: 10 },
    { metric_date: '2026-09-23', unique_visitors: 100, new_users: 10 },
    { metric_date: '2026-09-24', unique_visitors: 100, new_users: 10 },
    { metric_date: '2026-09-25', unique_visitors: 100, new_users: 10 },
    { metric_date: '2026-09-26', unique_visitors: 100, new_users: 10 },
    { metric_date: '2026-09-27', unique_visitors: 100, new_users: 10 },
    { metric_date: '2026-09-28', unique_visitors: 100, new_users: 10 },
    { metric_date: '2026-09-29', unique_visitors: 40, new_users: 1 },
    { metric_date: '2026-09-30', unique_visitors: 50, new_users: 2 }
  ];
  const alerts = buildAdminAlerts({
    rows,
    pendingInquiries: 12,
    unresolvedRenderFailures: 5,
    zeroPvRate: 45,
    publishedWorks: 20
  });
  const codes = alerts.map((alert) => alert.code);
  assert.ok(codes.includes('VISITORS_DOWN'));
  assert.ok(codes.includes('REGISTRATION_RATE_DOWN'));
  assert.ok(codes.includes('INQUIRIES_BACKLOG'));
  assert.ok(codes.includes('RENDER_FAILURES'));
  assert.ok(codes.includes('ZERO_PV_RATE_HIGH'));
});
