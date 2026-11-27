import assert from 'node:assert/strict';
import test from 'node:test';
import {
  prepareOfflineAggregatePrompt,
  reviewOfflineAggregateResponse
} from '../api/_lib/ai/offline-aggregate-review.js';
import {
  prepareOfflineSelectionPrompt,
  reviewOfflineSelectionResponse
} from '../api/_lib/ai/offline-selection-review.js';
import {
  prepareOfflineCommentPrompt,
  reviewOfflineCommentResponse
} from '../api/_lib/ai/offline-comment-review.js';

const principal = { id: 'SYNTHETIC_OWNER' };
const admin = { id: 'SYNTHETIC_ADMIN', isAdmin: true };
const novel = { id: 1, user_id: principal.id, publiclyVisible: true };
const episode = {
  id: 11,
  novel_id: 1,
  title: '第一話',
  content: '凛は青い鍵を持っていた。',
  episode_number: 1,
  order_index: 1
};
const work = {
  synthetic: true,
  principal,
  novel,
  plan: 'standard',
  episodeIds: [11],
  episodes: [
    episode,
    { ...episode, id: 12, episode_number: 2, content: 'UNSELECTED_BODY' }
  ],
  now: new Date('2026-11-27T00:00:00Z'),
  snapshot: {
    novelId: 1,
    days: 30,
    first_episode_reads_10s: 100,
    continued_to_episode_2: 60
  }
};
const finding = {
  kind: 'pacing',
  episodeId: '11',
  offset: 0,
  quote: '凛は',
  observation: '架空の確認候補'
};
const target = {
  synthetic: true,
  principal,
  novel,
  snapshot: {
    novelId: 1,
    days: 30,
    groups: [
      { group: 'new_to_work', started: 100, continued: 60 },
      { group: 'returning_to_work', started: 100, continued: 80 }
    ]
  }
};
const growth = {
  synthetic: true,
  principal,
  snapshot: {
    authorId: principal.id,
    days: 30,
    current_first_episode_reads_10s: 100,
    current_continued_to_episode_2: 60,
    previous_first_episode_reads_10s: 100,
    previous_continued_to_episode_2: 70
  }
};
const incident = {
  synthetic: true,
  principal: admin,
  days: 7,
  rows: [{ service: 'admin-reports', failureClass: '5xx', count: 3 }]
};
const report = {
  synthetic: true,
  principal: admin,
  snapshot: [{ id: 'case-1', status: 'new', category: 'other' }]
};
const rows = [
  {
    novelId: '1',
    title: '旅',
    description: '王都の門',
    genre: '幻想',
    tags: ['冒険']
  }
];
const discovery = { synthetic: true, principal, rows, query: '王都' };
const search = {
  synthetic: true,
  principal,
  snapshot: { query: '王都', genre: '幻想', tags: ['冒険'], rows }
};
const match = { novelId: '1', field: 'description', quote: '王都' };
const comment = {
  id: '1',
  novel_id: 1,
  can_moderate: true,
  is_hidden: false,
  is_spoiler: false,
  body: '続きが気になります。',
  user_id: 'PRIVATE_READER'
};
const comments = {
  synthetic: true,
  principal,
  novel,
  comments: [
    comment,
    { ...comment, id: '2', body: 'UNSELECTED_COMMENT' },
    { ...comment, id: '3', is_hidden: true, body: 'HIDDEN_COMMENT' }
  ],
  commentIds: ['1'],
  commentId: '1'
};

const aggregates = [
  prepareOfflineAggregatePrompt,
  reviewOfflineAggregateResponse
];
const selections = [
  prepareOfflineSelectionPrompt,
  reviewOfflineSelectionResponse
];
const commentFlow = [prepareOfflineCommentPrompt, reviewOfflineCommentResponse];

const cases = [
  [
    aggregates,
    'analytics-copilot',
    work,
    { items: [finding] },
    'analytics_review'
  ],
  [
    aggregates,
    'reader-dropoff-analysis',
    work,
    { items: [finding] },
    'continuation_review_candidates'
  ],
  [
    aggregates,
    'target-reader-analysis',
    target,
    { groups: ['new_to_work', 'returning_to_work'] },
    'observed_aggregate_only'
  ],
  [
    aggregates,
    'author-growth-report',
    growth,
    { metric: 'first_to_second_continuation' },
    'author_period_observations'
  ],
  [
    aggregates,
    'error-log-summary',
    incident,
    { keys: ['admin-reports:5xx'] },
    'observed_incident_counts'
  ],
  [
    aggregates,
    'report-triage',
    report,
    { ids: ['case-1'] },
    'report_review_selection'
  ],
  [
    selections,
    'natural-search-ai',
    search,
    { items: [match] },
    'natural_search_evidence'
  ],
  [
    selections,
    'discovery-assistant',
    discovery,
    { items: [match] },
    'public_metadata_matches'
  ],
  [
    commentFlow,
    'comment-summary',
    comments,
    {
      items: [{ kind: 'positive', commentId: '1', offset: 0, quote: '続き' }]
    },
    'comment_review_candidates'
  ],
  [
    commentFlow,
    'comment-reply-assistant',
    comments,
    { reply: 'ありがとうございます。' },
    'reply_draft'
  ]
];

async function mockTrial(flow, feature, input, mockGenerate, current = input) {
  assert.equal(input.synthetic, true);
  assert.equal(current.synthetic, true);
  const [prepare, review] = flow;
  const { prompt, requestHash } = prepare(feature, input);
  const modelText = await mockGenerate(prompt);
  return review(feature, current, { requestHash, modelText });
}

for (const [flow, feature, input, output, kind] of cases) {
  test('offline integration: ' + feature, async () => {
    const before = JSON.stringify(input);
    let calls = 0;
    const result = await mockTrial(flow, feature, input, async (prompt) => {
      calls += 1;
      assert.match(prompt.system, /untrusted/u);
      assert.doesNotMatch(
        prompt.user,
        /SYNTHETIC_|PRIVATE_READER|UNSELECTED_|HIDDEN_COMMENT/u
      );
      assert.ok(JSON.parse(prompt.user).task);
      return JSON.stringify(output);
    });
    assert.equal(calls, 1);
    assert.equal(result.kind, kind);
    assert.equal(JSON.stringify(input), before);
  });
}

test('small cohorts and unauthorized scopes fail before mock invocation', async () => {
  let calls = 0;
  const mock = async () => {
    calls += 1;
    return '{}';
  };
  const small = {
    ...work,
    snapshot: { ...work.snapshot, continued_to_episode_2: 2 }
  };
  await assert.rejects(mockTrial(aggregates, 'analytics-copilot', small, mock));
  const free = { ...work, plan: 'free' };
  await assert.rejects(mockTrial(aggregates, 'analytics-copilot', free, mock));
  const wrong = { ...work, episodeIds: [12] };
  await assert.rejects(
    mockTrial(aggregates, 'reader-dropoff-analysis', wrong, mock)
  );
  const unauthorized = { ...incident, principal };
  await assert.rejects(
    mockTrial(aggregates, 'error-log-summary', unauthorized, mock)
  );
  const hidden = { ...comments, commentId: '3' };
  await assert.rejects(
    mockTrial(commentFlow, 'comment-reply-assistant', hidden, mock)
  );
  assert.equal(calls, 0);
});

test('changed source or access rejects the whole response', async () => {
  const changed = {
    ...work,
    snapshot: { ...work.snapshot, continued_to_episode_2: 61 }
  };
  await assert.rejects(
    mockTrial(
      aggregates,
      'analytics-copilot',
      work,
      async () => JSON.stringify({ items: [finding] }),
      changed
    )
  );
  const removed = { ...discovery, rows: [] };
  await assert.rejects(
    mockTrial(
      selections,
      'discovery-assistant',
      discovery,
      async () => JSON.stringify({ items: [match] }),
      removed
    )
  );
  const edited = {
    ...comments,
    comments: [{ ...comment, body: '改訂' }]
  };
  await assert.rejects(
    mockTrial(
      commentFlow,
      'comment-reply-assistant',
      comments,
      async () => JSON.stringify({ reply: '返信案' }),
      edited
    )
  );
});

test('invented numbers, actions and unselected evidence are rejected', async () => {
  const invalidCases = [
    [
      aggregates,
      'analytics-copilot',
      work,
      { items: [{ ...finding, episodeId: '12' }] }
    ],
    [
      aggregates,
      'error-log-summary',
      incident,
      { keys: ['admin-reports:4xx'] }
    ],
    [aggregates, 'report-triage', report, { ids: ['case-1'], ban: true }],
    [
      selections,
      'natural-search-ai',
      search,
      { items: [{ ...match, score: 100 }] }
    ],
    [
      commentFlow,
      'comment-reply-assistant',
      comments,
      { reply: '返信', send: true }
    ]
  ];
  for (const [flow, feature, input, output] of invalidCases) {
    await assert.rejects(
      mockTrial(flow, feature, input, async () => JSON.stringify(output))
    );
  }
});
