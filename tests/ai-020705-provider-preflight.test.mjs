// Evidence-only 02-07-05 provider preflight: no external calls or state writes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { quoteAiProviderCeiling } from '../api/_lib/ai/price-quote.js';
import { createOpenAiTextProvider } from '../api/_lib/ai/providers.js';
import { reviewNovelBibleInference } from '../api/_lib/ai/novel-bible-inference-review.js';

// Price snapshots verified from provider documentation on 2026-11-01.
// NOT runtime price authorization or a guarantee of current billing.
const CANDIDATES = [
  {
    provider: 'openai',
    model: 'gpt-5.6-luna',
    inputUsdMicrosPerMillion: 200000,
    outputUsdMicrosPerMillion: 1200000,
    expectedCeilingMicros: 2528640
  },
  {
    provider: 'gemini',
    model: 'gemini-3.1-flash-lite',
    inputUsdMicrosPerMillion: 250000,
    outputUsdMicrosPerMillion: 1500000,
    expectedCeilingMicros: 3160800
  }
];

test('02-07-05 single-model official-price snapshot stays under proposed cap', () => {
  for (const candidate of CANDIDATES) {
    const plan = quoteAiProviderCeiling({
      routes: [{
        provider: candidate.provider,
        model: candidate.model,
        inputUsdMicrosPerMillion: candidate.inputUsdMicrosPerMillion,
        outputUsdMicrosPerMillion: candidate.outputUsdMicrosPerMillion,
        maxOutputTokens: 1024
      }],
      maxInputTokens: 36000,
      fxYenPerUsdCeiling: 200,
      riskBufferBps: 15000
    });
    assert.equal(plan.routes.length, 1);
    assert.equal(plan.quoteMicrosJPY, candidate.expectedCeilingMicros);
    assert.ok(plan.quoteMicrosJPY > 0);
    assert.ok(plan.quoteMicrosJPY < 10000000);
    assert.equal(plan.routes[0].model, candidate.model);
  }
});

test('02-07-05 selected model adapter keeps synthetic request private', async () => {
  let calls = 0;
  const provider = createOpenAiTextProvider({
    apiKey: 'synthetic-placeholder-not-a-credential',
    async fetchImpl(url, options) {
      calls += 1;
      assert.equal(url, 'https://api.openai.com/v1/responses');
      assert.equal(options.method, 'POST');
      const body = JSON.parse(options.body);
      assert.equal(body.model, 'gpt-5.6-luna');
      assert.equal(body.max_output_tokens, 1024);
      assert.equal(body.store, false);
      assert.equal(body.truncation, 'disabled');
      assert.equal(body.input, '架空の資料だけを抽出する');
      assert.equal(body.instructions, '合成文のみを検証する');
      assert.deepEqual(Object.keys(body).sort(), [
        'input', 'instructions', 'max_output_tokens', 'model', 'store',
        'truncation'
      ].sort());
      return {
        ok: true,
        async json() {
          return {
            output: [{
              content: [{ type: 'output_text', text: '{"suggestions":[]}' }]
            }],
            usage: { input_tokens: 25, output_tokens: 10 }
          };
        }
      };
    }
  });
  const result = await provider.generate({
    model: 'gpt-5.6-luna',
    system: '合成文のみを検証する',
    user: '架空の資料だけを抽出する',
    maxOutputTokens: 1024,
    timeoutMs: 1000
  });
  assert.equal(calls, 1);
  assert.equal(result.text, '{"suggestions":[]}');
  assert.deepEqual(result.usage, { inputTokens: 25, outputTokens: 10 });
  assert.ok(!JSON.stringify(result).includes('synthetic-placeholder'));
});

test('02-07-05 quote-backed evidence does not prove semantic truth', () => {
  const episode = {
    id: 19,
    novel_id: 41,
    title: '合成第一話',
    content: '凛は青い鍵を持ち、蒼は北門で待っていた。'
  };
  const sourceHash = createHash('sha256')
    .update(JSON.stringify([episode.title, episode.content]))
    .digest('hex');
  const result = reviewNovelBibleInference({
    principal: { id: 'synthetic-author' },
    novel: { id: 41, user_id: 'synthetic-author' },
    episode,
    sourceHash,
    modelText: JSON.stringify({
      suggestions: [{
        kind: 'character',
        key: '凛',
        summary: '凛は青い鍵を海へ捨てた。',
        evidence: '凛は青い鍵を持ち'
      }]
    })
  });
  // The excerpt exists, but its summary misstates the story. The automated
  // validator cannot establish semantic truth; it only creates a review item.
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].requiresAuthorReview, true);
  assert.equal(result.candidates[0].provenance, 'ai_inferred');
  assert.equal(
    result.candidates[0].factPayload.summary,
    '凛は青い鍵を海へ捨てた。'
  );
});
