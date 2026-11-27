import assert from 'node:assert/strict';
import test from 'node:test';
import {
  projectTargetReaderAggregates,
  reviewTargetReaderComparison,
  projectIncidentCounts,
  reviewIncidentSummary
} from '../api/_lib/ai/offline-aggregate-review.js';

const input = {
  principal: { id: 'owner' },
  novel: { id: 1, user_id: 'owner' },
  snapshot: {
    novelId: 1,
    days: 30,
    groups: [
      { group: 'new_to_work', started: 100, continued: 60 },
      { group: 'returning_to_work', started: 100, continued: 80 }
    ]
  },
  modelText: JSON.stringify({
    groups: ['new_to_work', 'returning_to_work']
  })
};

test('target comparison uses only the owner aggregate', () => {
  const result = reviewTargetReaderComparison(input);
  assert.equal(result.differencePoints, -20);
  assert.equal(result.interpretation, 'observed_difference_not_causal');
  assert.throws(() =>
    reviewTargetReaderComparison({ ...input, principal: { id: 'other' } })
  );
  const snapshot = { ...input.snapshot, novelId: 2 };
  assert.throws(() => projectTargetReaderAggregates({ ...input, snapshot }));
});

test('small cells and complements suppress the whole comparison', () => {
  for (const [started, continued] of [
    [49, 20],
    [100, 9],
    [100, 91]
  ]) {
    const snapshot = {
      ...input.snapshot,
      groups: [
        { group: 'new_to_work', started, continued },
        input.snapshot.groups[1]
      ]
    };
    const result = reviewTargetReaderComparison({ ...input, snapshot });
    assert.deepEqual(result.groups, []);
    assert.equal(result.kind, 'insufficient_aggregate');
  }
});

test('reader aggregate rejects private attributes and forged numbers', () => {
  const groups = [
    { ...input.snapshot.groups[0], readerId: 'private' },
    input.snapshot.groups[1]
  ];
  const snapshot = { ...input.snapshot, groups };
  assert.throws(() => projectTargetReaderAggregates({ ...input, snapshot }));
  const modelText = JSON.stringify({ groups: ['new_to_work'], rate: 99 });
  assert.throws(() => reviewTargetReaderComparison({ ...input, modelText }));
});

const incident = {
  days: 7,
  rows: [
    { service: 'admin-reports', failureClass: '5xx', count: 3 },
    { service: 'thumbnail-render', failureClass: 'render_failed', count: 2 }
  ],
  modelText: JSON.stringify({ keys: ['admin-reports:5xx'] })
};

test('incident output selects observed counts but not root cause', () => {
  const result = reviewIncidentSummary(incident);
  assert.deepEqual(result.items, [{ key: 'admin-reports:5xx', count: 3 }]);
  assert.equal(result.rootCauseVerified, false);
  const modelText = JSON.stringify({ keys: ['admin-reports:4xx'] });
  assert.throws(() => reviewIncidentSummary({ ...incident, modelText }));
});

test('incident projection rejects raw logs and secret-bearing fields', () => {
  const rows = [{ ...incident.rows[0], message: 'Bearer test-secret' }];
  assert.throws(() => projectIncidentCounts({ ...incident, rows }));
  assert.throws(() =>
    projectIncidentCounts({
      ...incident,
      rows: [{ service: 'arbitrary', failureClass: '5xx', count: 1 }]
    })
  );
  const modelText = JSON.stringify({ keys: [], cause: 'guessed' });
  assert.throws(() => reviewIncidentSummary({ ...incident, modelText }));
});
