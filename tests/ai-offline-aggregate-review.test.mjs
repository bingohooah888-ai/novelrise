import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import {
  projectTargetReaderAggregates,
  reviewTargetReaderComparison,
  projectIncidentCounts,
  reviewIncidentSummary,
  projectWorkRetention,
  reviewAnalyticsCopilot,
  reviewDropoffCandidates,
  reviewAuthorGrowth
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

const episode = {
  id: 11,
  novel_id: 1,
  episode_number: 1,
  order_index: 1,
  title: '門',
  content: '王都の門'
};
const secondEpisode = {
  ...episode,
  id: 12,
  episode_number: 2,
  order_index: 2
};
const sourceHash = createHash('sha256')
  .update(JSON.stringify([episode.title, episode.content]))
  .digest('hex');
const finding = {
  kind: 'pacing',
  episodeId: '11',
  offset: 0,
  quote: '王都の門',
  observation: '確認候補'
};
const analytics = {
  principal: input.principal,
  novel: input.novel,
  plan: 'standard',
  snapshot: {
    novelId: 1,
    days: 30,
    first_episode_reads_10s: 100,
    continued_to_episode_2: 60
  },
  episodes: [episode, secondEpisode],
  expectedRevisions: { 11: sourceHash, 12: sourceHash },
  modelText: JSON.stringify({ items: [finding] })
};

test('analytics separates observed counts and manuscript hypotheses', () => {
  const result = reviewAnalyticsCopilot(analytics);
  assert.equal(result.observed.cohort.rate, 60);
  assert.equal(result.hypotheses.length, 1);
  assert.equal(result.causalRelationshipVerified, false);
  assert.throws(() => projectWorkRetention({ ...analytics, plan: 'free' }));
  const snapshot = { ...analytics.snapshot, novelId: 2 };
  assert.throws(() => projectWorkRetention({ ...analytics, snapshot }));
  const small = {
    ...analytics.snapshot,
    continued_to_episode_2: 9
  };
  assert.equal(
    projectWorkRetention({ ...analytics, snapshot: small }).cohort,
    null
  );
});

test('dropoff hypotheses are limited to the known first episode', () => {
  const result = reviewDropoffCandidates(analytics);
  assert.equal(result.dropoffLocationVerified, false);
  assert.equal(result.observed.cohort.withoutRecordedContinuation, 40);
  const modelText = JSON.stringify({
    items: [{ ...finding, episodeId: '12' }]
  });
  assert.throws(() => reviewDropoffCandidates({ ...analytics, modelText }));
});

test('growth compares author periods without claiming improvement', () => {
  const snapshot = {
    authorId: 'owner',
    days: 30,
    current_first_episode_reads_10s: 100,
    current_continued_to_episode_2: 70,
    previous_first_episode_reads_10s: 100,
    previous_continued_to_episode_2: 60
  };
  const modelText = JSON.stringify({ metric: 'first_to_second_continuation' });
  const request = { principal: input.principal, snapshot, modelText };
  const result = reviewAuthorGrowth(request);
  assert.equal(result.differencePoints, 10);
  assert.equal(result.unequalFollowup, true);
  assert.equal(result.improvementVerified, false);
  const small = { ...snapshot, previous_continued_to_episode_2: 99 };
  const suppressed = reviewAuthorGrowth({ ...request, snapshot: small });
  assert.equal(suppressed.current, null);
  assert.equal(suppressed.previous, null);
  assert.throws(() =>
    reviewAuthorGrowth({ ...request, principal: { id: 'other' } })
  );
});
