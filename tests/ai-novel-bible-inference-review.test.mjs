import assert from 'node:assert/strict';
import test from 'node:test';

import {
  reviewNovelBibleInference
} from '../api/_lib/ai/novel-bible-inference-review.js';
import { planNovelBibleEpisodeChanges } from '../api/_lib/ai/novel-bible.js';

const principal = { id: 'test-owner' };
const novel = { id: 41, user_id: 'test-owner' };
const episode = {
  id: 19,
  novel_id: 41,
  title: '第一話',
  content: '主人公の蒼は北門で幼なじみの凛と再会した。凛は青い鍵を持っている。',
  order_index: 1
};
const sourceHash = planNovelBibleEpisodeChanges({
  principal,
  novel,
  episodes: [episode],
  analyses: []
}).pending[0].sourceHash;

const suggestion = {
  kind: 'character',
  key: '凛',
  summary: '蒼の幼なじみ。青い鍵を持っている。',
  evidence: '凛は青い鍵を持っている。'
};

function review(changes = {}) {
  return reviewNovelBibleInference({
    principal,
    novel,
    episode,
    sourceHash,
    modelText: JSON.stringify({ suggestions: [suggestion] }),
    ...changes
  });
}

test('02-07 derives provenance and source metadata only from trusted records', () => {
  const result = review({
    authorConfirmedFacts: [{ kind: 'character', key: '凛' }]
  });
  assert.equal(result.novelId, 41);
  assert.deepEqual(result.candidates, [
    {
      factKind: 'character',
      factKey: '凛',
      factPayload: {
        summary: suggestion.summary,
        evidence: suggestion.evidence
      },
      sourceEpisodeId: 19,
      sourceHash,
      provenance: 'ai_inferred',
      requiresAuthorReview: true,
      conflictsWithAuthorCanon: true
    }
  ]);
  assert.equal(result.candidates[0].requiresAuthorReview, true);
});

test('new candidates are review-only and never converted to confirmed canon', () => {
  const result = review();
  assert.equal(result.candidates[0].provenance, 'ai_inferred');
  assert.equal(result.candidates[0].requiresAuthorReview, true);
  assert.equal(result.candidates[0].conflictsWithAuthorCanon, false);
  assert.ok(!Object.hasOwn(result.candidates[0], 'writeAction'));
});

test('an empty valid inference is an empty review list, not generated facts', () => {
  const result = review({ modelText: '{"suggestions":[]}' });
  assert.deepEqual(result, { novelId: 41, candidates: [] });
});

test('owner and episode scope are verified before model output is accepted', () => {
  for (const changes of [
    { principal: { id: 'other' } },
    { episode: { ...episode, novel_id: 99 } },
    { episode: { ...episode, id: 0 } },
    { episode: { ...episode, content: 'a revised chapter' } },
    { sourceHash: '0'.repeat(64) }
  ]) {
    assert.throws(() => review(changes), /AI_/);
  }
});

test('model output cannot invent source quotes or privileged metadata', () => {
  for (const modelText of [
    'not json',
    '{"suggestions":[{"kind":"world","key":"a","summary":"b","evidence":"wrong"}]}',
    JSON.stringify({
      suggestions: [{ ...suggestion, provenance: 'author_confirmed' }]
    }),
    JSON.stringify({
      suggestions: [{ ...suggestion, sourceEpisodeId: 999 }]
    }),
    JSON.stringify({
      suggestions: [{ ...suggestion, writeAction: 'publish' }]
    }),
    JSON.stringify({
      suggestions: [{ ...suggestion, kind: 'unapproved-kind' }]
    }),
    JSON.stringify({ suggestions: [suggestion, suggestion] }),
    JSON.stringify({ suggestions: Array.from({ length: 13 }, () => suggestion) }),
    JSON.stringify({
      suggestions: [{ ...suggestion, summary: 'a'.repeat(321) }]
    }),
    JSON.stringify({ suggestions: [suggestion], commands: ['delete'] })
  ]) {
    assert.throws(() => review({ modelText }), /AI_BIBLE_INFERENCE_INVALID/);
  }
});

test('the authoritative chapter and model response have bounded sizes', () => {
  assert.throws(
    () => review({ modelText: ' '.repeat(16001) }),
    /AI_BIBLE_INFERENCE_INVALID/
  );
  assert.throws(
    () =>
      review({
        episode: { ...episode, content: 'あ'.repeat(400000) }
      }),
    /AI_BIBLE_INFERENCE_INVALID/
  );
  assert.throws(
    () =>
      review({
        authorConfirmedFacts: [{ kind: 'character', key: '' }]
      }),
    /AI_BIBLE_INFERENCE_INVALID/
  );
});
