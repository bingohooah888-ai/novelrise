import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  reviewOfficialThumbnail,
  reviewFaqSelection,
  reviewDiscoverySelection
} from '../api/_lib/ai/offline-selection-review.js';

const digest = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const asset = (id, layer, status = 'active', template = 'fixed') => ({
  id,
  template_key: template,
  layer_type: layer,
  availability_status: status
});
const snapshot = {
  templateKey: 'fixed',
  assets: [
    asset('bg', 'background'),
    asset('book', 'base_book'),
    asset('cover', 'cover'),
    asset('bad', 'frame', 'emergency_disabled'),
    asset('other', 'symbol', 'active', 'other')
  ]
};
const choices = [
  { layer: 'background', assetId: 'bg' },
  { layer: 'base_book', assetId: 'book' }
];
function thumbnail(selections, extra = {}) {
  return reviewOfficialThumbnail({
    snapshot,
    expectedHash: digest(snapshot),
    modelText: JSON.stringify({ templateKey: 'fixed', selections }),
    ...extra
  });
}

test('thumbnail candidates contain only official author layer IDs', () => {
  const result = thumbnail(choices);
  assert.deepEqual(result.selections, choices);
  assert.equal(result.requiresAuthorReview, true);
  for (const item of [
    { layer: 'cover', assetId: 'cover' },
    { layer: 'frame', assetId: 'bad' },
    { layer: 'symbol', assetId: 'other' },
    { layer: 'symbol', assetId: 'https://bad.example' },
    { ...choices[0], image_url: 'https://bad.example' }
  ]) {
    assert.throws(() => thumbnail([...choices, item]));
  }
  assert.throws(() => thumbnail(choices.slice(1)));
  assert.throws(() =>
    thumbnail(choices, {
      snapshot: { ...snapshot, assets: snapshot.assets.slice(1) }
    })
  );
});

const topics = [
  {
    key: 'getting-started',
    title: 'はじめて',
    summary: '公式説明',
    points: ['読書の基本', '作者の基本']
  }
];
function faq(items, extra = {}) {
  return reviewFaqSelection({
    topics,
    expectedHash: digest(topics),
    modelText: JSON.stringify({ items }),
    ...extra
  });
}

test('FAQ answers are selected official text, not model prose', () => {
  const item = { key: 'getting-started', part: 'point', index: 1 };
  const result = faq([item]);
  assert.equal(result.items[0].quote, '作者の基本');
  assert.equal(result.items[0].href, 'help.html#getting-started');
  assert.equal(faq([]).fallbackHref, 'contact.html');
  assert.throws(() => faq([{ ...item, index: 9 }]));
  assert.throws(() => faq([{ ...item, quote: '架空' }]));
  assert.throws(() => faq([{ ...item, key: 'unknown' }]));
  assert.throws(() => faq([item], { expectedHash: '0'.repeat(64) }));
});

const rows = [
  {
    novelId: '1',
    title: '旅',
    description: '王都への旅',
    genre: '幻想',
    tags: ['冒険']
  },
  {
    novelId: '2',
    title: '門',
    description: '王都の門',
    genre: '幻想',
    tags: ['謎']
  }
];
function discovery(items, extra = {}) {
  return reviewDiscoverySelection({
    rows,
    expectedHash: digest(rows),
    modelText: JSON.stringify({ items }),
    ...extra
  });
}

test('discovery preserves the approved candidate order and evidence', () => {
  const first = { novelId: '1', field: 'description', quote: '王都' };
  const second = { novelId: '2', field: 'tag', quote: '謎' };
  const result = discovery([second, first]);
  assert.deepEqual(
    result.items.map((item) => item.novelId),
    ['1', '2']
  );
  assert.throws(() => discovery([{ ...first, novelId: '99' }]));
  assert.throws(() => discovery([{ ...first, score: 10 }]));
  assert.throws(() => discovery([{ ...first, quote: '秘密' }]));
  assert.throws(() => discovery([first, first]));
  assert.throws(() => discovery([first], { rows: rows.slice(1) }));
});
