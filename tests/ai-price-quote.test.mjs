import assert from 'node:assert/strict';
import test from 'node:test';

import { quoteAiProviderCeiling } from '../api/_lib/ai/price-quote.js';

const flash = {
  provider: 'gemini',
  model: 'gemini-2.5-flash',
  inputUsdMicrosPerMillion: 300000,
  outputUsdMicrosPerMillion: 2500000,
  maxOutputTokens: 1500
};

function quote(overrides = {}) {
  return quoteAiProviderCeiling({
    routes: [flash],
    maxInputTokens: 12000,
    fxYenPerUsdCeiling: 160,
    riskBufferBps: 12500,
    ...overrides
  });
}

test('02-07-03 quotes micro-JPY consistently with router units', () => {
  const result = quote();
  assert.equal(result.quoteMicrosJPY, 1470000);
  assert.equal(result.routes[0].inputMicrosPerMillion, 60000000);
  assert.equal(result.routes[0].outputMicrosPerMillion, 500000000);
  assert.equal(result.routes[0].ceilingMicros, 1470000);
  assert.equal(result.routes[0].model, flash.model);
});

test('includes two full attempts when fallback may also be charged', () => {
  const second = {
    provider: 'openai',
    model: 'gpt-5.4-mini',
    inputUsdMicrosPerMillion: 750000,
    outputUsdMicrosPerMillion: 4500000,
    maxOutputTokens: 1500
  };
  const result = quote({ routes: [flash, second] });
  assert.equal(result.routes[1].ceilingMicros, 3150000);
  assert.equal(result.quoteMicrosJPY, 4620000);
});

test('rounds every rate and ceiling upward for tiny requests', () => {
  const result = quote({
    routes: [{ ...flash, inputUsdMicrosPerMillion: 1 }],
    maxInputTokens: 1,
    fxYenPerUsdCeiling: 1,
    riskBufferBps: 10001
  });
  assert.equal(result.routes[0].inputMicrosPerMillion, 2);
  assert.ok(result.quoteMicrosJPY > 0);
});

test('missing prices, exchange rate and invalid numbers fail closed', () => {
  const invalid = [
    { fxYenPerUsdCeiling: undefined },
    { fxYenPerUsdCeiling: 0 },
    { maxInputTokens: 0 },
    { maxInputTokens: 50000 },
    { riskBufferBps: 9999 },
    { riskBufferBps: Infinity },
    { routes: [] },
    { routes: [flash, flash, flash] },
    { routes: [{ ...flash, inputUsdMicrosPerMillion: 0 }] },
    { routes: [{ ...flash, outputUsdMicrosPerMillion: NaN }] },
    { routes: [{ ...flash, provider: 'unknown' }] },
    { routes: [{ ...flash, model: '../private' }] },
    { routes: [{ ...flash, maxOutputTokens: 9000 }] }
  ];
  for (const change of invalid) {
    assert.throws(() => quote(change), /AI_PRICE_QUOTE_INVALID/);
  }
});

test('quotes contain no raw prompts, author text or network calls', () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error('AI_NETWORK_CALL_FORBIDDEN');
  };
  try {
    const result = quote();
    assert.deepEqual(Object.keys(result).sort(), [
      'maxInputTokens',
      'quoteMicrosJPY',
      'riskBufferBps',
      'routes'
    ]);
    assert.deepEqual(Object.keys(result.routes[0]).sort(), [
      'ceilingMicros',
      'inputMicrosPerMillion',
      'maxOutputTokens',
      'model',
      'outputMicrosPerMillion',
      'provider'
    ]);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('02-07-05 pessimistic quote includes every route and is monotonic', () => {
  const routes = [
    flash,
    {
      provider: 'openai',
      model: 'synthetic-offline',
      inputUsdMicrosPerMillion: 750000,
      outputUsdMicrosPerMillion: 4500000,
      maxOutputTokens: 1500
    }
  ];
  const low = quote({
    routes,
    fxYenPerUsdCeiling: 150,
    riskBufferBps: 10000
  });
  const high = quote({
    routes,
    fxYenPerUsdCeiling: 170,
    riskBufferBps: 15000
  });
  for (const result of [low, high]) {
    assert.equal(
      result.quoteMicrosJPY,
      result.routes.reduce((total, route) => total + route.ceilingMicros, 0)
    );
    assert.ok(result.routes.every((route) => route.ceilingMicros > 0));
  }
  assert.ok(high.quoteMicrosJPY >= low.quoteMicrosJPY);
  assert.ok(high.quoteMicrosJPY > 0);
});
