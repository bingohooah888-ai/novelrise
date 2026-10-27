import assert from 'node:assert/strict';
import test from 'node:test';

import * as ai from '../api/_lib/ai/novel-bible-inference-review.js';
import { planNovelBibleEpisodeChanges } from '../api/_lib/ai/novel-bible.js';

const principal = { id: 'author-test' };
const novel = { id: 41, user_id: 'author-test' };
const episode = {
  id: 19,
  novel_id: 41,
  title: '第一話',
  content: '蒼は北門で凛と再会した。凛は青い鍵を持っている。',
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
  summary: '蒼の幼なじみで青い鍵を持つ。',
  evidence: '凛は青い鍵を持っている。'
};

function asJson(suggestions) {
  return JSON.stringify({ suggestions });
}

function review(changes = {}) {
  return ai.reviewNovelBibleInference({
    principal,
    novel,
    episode,
    sourceHash,
    modelText: asJson([suggestion]),
    ...changes
  });
}

test('02-07 safely marks inferred facts for author review', () => {
  const result = review({
    authorConfirmedFacts: [{ kind: 'character', key: '凛' }]
  });
  assert.equal(result.novelId, 41);
  assert.equal(result.candidates.length, 1);
  const candidate = result.candidates[0];
  assert.equal(candidate.factKind, 'character');
  assert.equal(candidate.factKey, '凛');
  assert.equal(candidate.factPayload.evidence, suggestion.evidence);
  assert.equal(candidate.sourceEpisodeId, episode.id);
  assert.equal(candidate.sourceHash, sourceHash);
  assert.equal(candidate.provenance, 'ai_inferred');
  assert.equal(candidate.requiresAuthorReview, true);
  assert.equal(candidate.conflictsWithAuthorCanon, true);
  assert.ok(!Object.hasOwn(candidate, 'writeAction'));
});

test('new and empty suggestions do not become author canon', () => {
  const fresh = review();
  assert.equal(fresh.candidates[0].conflictsWithAuthorCanon, false);
  assert.equal(fresh.candidates[0].requiresAuthorReview, true);
  const empty = review({ modelText: asJson([]) });
  assert.deepEqual(empty, { novelId: 41, candidates: [] });
});

test('wrong owner, wrong novel and revised episodes fail closed', () => {
  const cases = [
    { principal: { id: 'other' } },
    { episode: { ...episode, novel_id: 99 } },
    { episode: { ...episode, id: 0 } },
    { episode: { ...episode, content: '改稿済み' } },
    { sourceHash: '0'.repeat(64) }
  ];
  for (const change of cases) {
    assert.throws(() => review(change), /AI_/);
  }
});

test('provider output cannot forge provenance, metadata or source quotes', () => {
  const cases = [
    'not-json',
    asJson([{ ...suggestion, evidence: '架空の引用' }]),
    asJson([{ ...suggestion, provenance: 'author_confirmed' }]),
    asJson([{ ...suggestion, sourceEpisodeId: 999 }]),
    asJson([{ ...suggestion, writeAction: 'publish' }]),
    asJson([{ ...suggestion, kind: 'unapproved' }]),
    asJson([suggestion, suggestion]),
    asJson(Array(13).fill(suggestion)),
    asJson([{ ...suggestion, summary: 'a'.repeat(321) }]),
    JSON.stringify({ suggestions: [suggestion], commands: ['publish'] })
  ];
  for (const modelText of cases) {
    assert.throws(() => review({ modelText }), /AI_BIBLE_INFERENCE_INVALID/);
  }
});

test('oversized text and malformed confirmed facts fail closed', () => {
  const cases = [
    { modelText: ' '.repeat(16001) },
    { episode: { ...episode, content: 'あ'.repeat(400000) } },
    { authorConfirmedFacts: [{ kind: 'character', key: '' }] }
  ];
  for (const change of cases) {
    assert.throws(() => review(change), /AI_BIBLE_INFERENCE_INVALID/);
  }
});
