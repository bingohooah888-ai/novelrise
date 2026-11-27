import assert from 'node:assert/strict';
import test from 'node:test';
import {
  prepareOfflineEvidencePrompt,
  reviewOfflineEvidenceResponse
} from '../api/_lib/ai/offline-evidence-review.js';
import {
  prepareOfflineSelectionPrompt,
  reviewOfflineSelectionResponse
} from '../api/_lib/ai/offline-selection-review.js';
import {
  prepareOfflinePolicyPrompt,
  reviewOfflinePolicyResponse
} from '../api/_lib/ai/offline-policy-review.js';
import {
  prepareOfflineAggregatePrompt,
  reviewOfflineAggregateResponse
} from '../api/_lib/ai/offline-aggregate-review.js';
import {
  prepareOfflineCommentPrompt,
  reviewOfflineCommentResponse
} from '../api/_lib/ai/offline-comment-review.js';

const owner = { id: 'SYNTHETIC_OWNER' };
const admin = { id: 'SYNTHETIC_ADMIN', isAdmin: true };
const reader = { id: 'SYNTHETIC_READER' };
const novel = { id: 1, user_id: owner.id, publiclyVisible: true };
const author = { synthetic: true, principal: owner, novel };
const operator = { synthetic: true, principal: admin };
const now = new Date('2026-11-27T00:00:00Z');
const episode = {
  id: 11,
  novel_id: 1,
  order_index: 1,
  status: 'published',
  publiclyVisible: true,
  title: '門',
  content: '王都の門に凛が立つ。'
};
const publication = {
  ...author,
  now,
  episodeIds: [11],
  episodes: [
    episode,
    { ...episode, id: 12, order_index: 2, content: 'UNSELECTED_BODY' }
  ]
};
const metadata = {
  ...author,
  metadata: { novelId: 1, title: '門', description: '王都への旅' }
};
const asset = (id, layer, status = 'active') => ({
  id,
  template_key: 'fixed',
  layer_type: layer,
  availability_status: status
});
const thumbnail = {
  ...author,
  theme: '幻想',
  snapshot: {
    templateKey: 'fixed',
    assets: [
      asset('bg', 'background'),
      asset('book', 'base_book'),
      asset('DISABLED_ASSET', 'frame', 'emergency_disabled'),
      asset('COVER_ASSET', 'cover')
    ]
  }
};
const thumbnailOutput = {
  templateKey: 'fixed',
  selections: [
    { layer: 'background', assetId: 'bg' },
    { layer: 'base_book', assetId: 'book' }
  ]
};
const later = {
  ...episode,
  id: 12,
  order_index: 2,
  content: 'FUTURE_SECRET'
};
const spoiler = {
  synthetic: true,
  principal: reader,
  novel,
  now,
  episodes: [episode, later],
  progress: { completedEpisodeIds: [11] },
  comments: [
    { id: '1', novelId: 1, visible: true, body: 'FUTURE_SECRET' },
    { id: '2', novelId: 1, visible: true, body: '感想' }
  ],
  references: [{ id: '3', episodeId: '12', term: 'FUTURE_SECRET' }]
};
const policy = [{ section: '5', body: '区分の虚偽申告は禁止します。' }];
const subject = { id: '1', body: '架空の確認対象' };
const moderation = {
  ...operator,
  policy,
  comment: { ...subject, visible: true }
};
const policyReview = { ...operator, policy, subject };
const evidence = {
  section: '5',
  policyQuote: policy[0].body,
  offset: 0,
  quote: subject.body
};
const signal = {
  id: 'signal-1',
  status: 'active',
  signalType: 'robotic_valid_read_burst'
};
const abuse = {
  ...operator,
  snapshot: [signal, { ...signal, id: 'DISMISSED_SIGNAL', status: 'dismissed' }]
};
const classification = {
  ...operator,
  snapshot: {
    novelId: '1',
    title: '旅',
    description: '王都への旅',
    genre: '幻想',
    genres: ['幻想', '冒険']
  }
};
const topics = [
  {
    key: 'publishing',
    title: '投稿',
    summary: '公式の公開手順',
    points: ['作品を選択する']
  }
];
const faq = { ...operator, topics, query: '公開方法' };
const inquiry = {
  ...operator,
  topics,
  snapshot: {
    id: 'PRIVATE_CASE_ID',
    redactedBody: '公開方法について',
    categories: ['publishing', 'other']
  }
};
const faqItem = { key: 'publishing', part: 'point', index: 0 };
const kpi = {
  ...operator,
  snapshot: {
    days: 7,
    rows: [
      { metric: 'newUsers', current: 100, previous: 80 },
      { metric: 'readingUsers', current: 2, previous: 1 }
    ]
  }
};

const evidenceFlow = [
  prepareOfflineEvidencePrompt,
  reviewOfflineEvidenceResponse
];
const selectionFlow = [
  prepareOfflineSelectionPrompt,
  reviewOfflineSelectionResponse
];
const policyFlow = [prepareOfflinePolicyPrompt, reviewOfflinePolicyResponse];
const commentFlow = [prepareOfflineCommentPrompt, reviewOfflineCommentResponse];
const aggregateFlow = [
  prepareOfflineAggregatePrompt,
  reviewOfflineAggregateResponse
];

const cases = [
  [
    selectionFlow,
    'thumbnail-coordinator',
    thumbnail,
    thumbnailOutput,
    'official_material_candidates'
  ],
  [
    evidenceFlow,
    'title-synopsis-ab',
    metadata,
    { items: [{ title: '王都の門', description: '凛の旅' }] },
    'metadata_drafts'
  ],
  [
    commentFlow,
    'spoiler-comment-detection',
    spoiler,
    { items: [{ commentId: '1', referenceId: '3' }] },
    'spoiler_warning_candidates'
  ],
  [
    evidenceFlow,
    'publishing-preparation',
    publication,
    {
      items: [{ kind: 'setting', episodeId: '11', offset: 0, quote: '王都' }]
    },
    'publishing_source_outline'
  ],
  [
    policyFlow,
    'comment-moderation',
    moderation,
    { items: [evidence] },
    'comment_moderation_candidates'
  ],
  [
    aggregateFlow,
    'abuse-analysis',
    abuse,
    { ids: ['signal-1'] },
    'abuse_signal_review'
  ],
  [
    selectionFlow,
    'classification-anomaly',
    classification,
    { items: [{ genre: '冒険', field: 'description', quote: '旅' }] },
    'classification_review_candidates'
  ],
  [
    policyFlow,
    'policy-risk-review',
    policyReview,
    { items: [evidence] },
    'policy_review_candidates'
  ],
  [
    selectionFlow,
    'inquiry-assistant',
    inquiry,
    { category: 'publishing', items: [faqItem] },
    'inquiry_review_draft'
  ],
  [
    selectionFlow,
    'official-faq-assistant',
    faq,
    { items: [faqItem] },
    'official_help_excerpts'
  ],
  [
    aggregateFlow,
    'kpi-anomaly',
    kpi,
    { metrics: ['newUsers'] },
    'kpi_change_review'
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
  test('offline flow: ' + feature, async () => {
    const before = JSON.stringify(input);
    let calls = 0;
    const result = await mockTrial(flow, feature, input, async (prompt) => {
      calls += 1;
      assert.match(prompt.system, /untrusted/u);
      assert.doesNotMatch(prompt.user, /SYNTHETIC_|PRIVATE_CASE_ID/u);
      assert.doesNotMatch(prompt.user, /UNSELECTED_BODY|FUTURE_SECRET/u);
      assert.doesNotMatch(prompt.user, /DISABLED_ASSET|COVER_ASSET/u);
      assert.doesNotMatch(prompt.user, /DISMISSED_SIGNAL|readingUsers/u);
      assert.ok(JSON.parse(prompt.user).task);
      return JSON.stringify(output);
    });
    assert.equal(calls, 1);
    assert.equal(result.kind, kind);
    assert.equal(JSON.stringify(input), before);
    if (feature === 'spoiler-comment-detection') {
      assert.deepEqual(result.items, [{ commentId: '1' }]);
      assert.doesNotMatch(JSON.stringify(result), /FUTURE_SECRET/u);
    }
    if (feature === 'title-synopsis-ab') {
      assert.equal(result.experimentStarted, false);
    }
    if (feature === 'kpi-anomaly') {
      assert.equal(result.statisticalAnomalyVerified, false);
    }
  });
}

test('access and stale inputs fail closed', async () => {
  for (const [flow, feature, input, output] of cases) {
    const denied = { ...input, principal: { id: 'OTHER' } };
    const mock = async () => JSON.stringify(output);
    // A public reader is permitted, but changing identity invalidates a reply.
    await assert.rejects(mockTrial(flow, feature, input, mock, denied));
  }
  const changed = {
    ...policyReview,
    subject: { ...subject, body: '改訂' }
  };
  const mock = async () => JSON.stringify({ items: [evidence] });
  await assert.rejects(
    mockTrial(policyFlow, 'policy-risk-review', policyReview, mock, changed)
  );
});

test('ineligible results and unapproved features fail closed', async () => {
  const invalidCases = [
    [aggregateFlow, 'kpi-anomaly', kpi, { metrics: ['readingUsers'] }],
    [aggregateFlow, 'abuse-analysis', abuse, { ids: ['DISMISSED_SIGNAL'] }],
    [
      commentFlow,
      'spoiler-comment-detection',
      spoiler,
      { items: [{ commentId: '2', referenceId: '3' }] }
    ],
    [policyFlow, 'policy-risk-review', policyReview, { items: [], ban: true }],
    [selectionFlow, 'official-faq-assistant', faq, { items: [], send: true }]
  ];
  for (const [flow, feature, input, output] of invalidCases) {
    await assert.rejects(
      mockTrial(flow, feature, input, async () => JSON.stringify(output))
    );
  }
  for (const feature of ['translation-assistant', 'plagiarism-detection']) {
    assert.throws(() => prepareOfflineEvidencePrompt(feature, publication));
  }
});

test('reader progress and revoked moderation scope invalidate responses', async () => {
  const read = { ...spoiler, progress: { completedEpisodeIds: [11, 12] } };
  const mock = async () =>
    JSON.stringify({ items: [{ commentId: '1', referenceId: '3' }] });
  await assert.rejects(
    mockTrial(commentFlow, 'spoiler-comment-detection', spoiler, mock, read)
  );
  const revoked = { ...moderation, comment: { ...subject, visible: false } };
  const reviewMock = async () => JSON.stringify({ items: [evidence] });
  await assert.rejects(
    mockTrial(
      policyFlow,
      'comment-moderation',
      moderation,
      reviewMock,
      revoked
    )
  );
});
