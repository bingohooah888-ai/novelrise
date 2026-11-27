import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { createOfflineConnectedReview } from '../api/_lib/ai/offline-connected-review.js';

const hash = 'a'.repeat(64);
const candidate = { requestHash: hash, modelText: '{}' };
const auth = { token: 'synthetic' };
const admin = { req: {}, res: {} };

test('handoff delegates source and answer checks to existing reader', async () => {
  const calls = [];
  const reader = {
    async prepare(...args) {
      calls.push(args);
      return { requestHash: hash, prompt: { system: 's', user: 'u' } };
    },
    async review(...args) {
      calls.push(args);
      return { kind: 'work_analysis_candidates', items: [] };
    }
  };
  const api = createOfflineConnectedReview({ owner: reader });
  const request = {
    featureKey: 'work-analysis',
    selection: { novelId: 1, episodeIds: [2] }
  };
  assert.equal((await api.prepare(request, auth)).requestHash, hash);
  const response = await api.review(request, auth, candidate);
  assert.deepEqual(response, {
    featureKey: 'work-analysis',
    result: { kind: 'work_analysis_candidates', items: [] }
  });
  assert.deepEqual(calls, [
    ['work-analysis', request.selection, auth.token],
    ['work-analysis', request.selection, auth.token, candidate]
  ]);
  await assert.rejects(api.prepare({ ...request, prompt: 'injected' }, auth));
  await assert.rejects(api.prepare(request, admin));
  await assert.rejects(
    api.review(request, auth, { ...candidate, action: 'save' })
  );
});

test('admin readers keep their distinct call contracts', async () => {
  const report = {
    async prepare(...args) {
      assert.deepEqual(args, [admin.req, admin.res]);
      return { requestHash: hash, prompt: { system: 's', user: 'u' } };
    },
    async review(...args) {
      assert.deepEqual(args, [admin.req, admin.res, candidate]);
      return { kind: 'report_review_selection', items: [] };
    }
  };
  const api = createOfflineConnectedReview({ report });
  const request = { featureKey: 'report-triage', selection: {} };
  await api.prepare(request, admin);
  await api.review(request, admin, candidate);
  await assert.rejects(api.prepare(request, auth));
  await assert.rejects(
    api.prepare({ ...request, selection: { id: '1' } }, admin)
  );
  await assert.rejects(
    api.prepare({ featureKey: 'kpi-anomaly', selection: {} }, admin)
  );
});

test('held features and mismatched responses fail closed', async () => {
  const api = createOfflineConnectedReview({
    owner: {
      async prepare() {
        throw Error('private database error');
      },
      async review() {
        return { kind: 'reply_draft', reply: 'wrong feature' };
      }
    }
  });
  for (const featureKey of [
    'target-reader-analysis',
    'who-is-this-character',
    'spoiler-safe-recap',
    'spoiler-safe-glossary',
    'spoiler-comment-detection',
    'art-generation',
    'novel-bible'
  ]) {
    await assert.rejects(api.prepare({ featureKey, selection: {} }, auth));
  }
  const request = { featureKey: 'work-analysis', selection: {} };
  await assert.rejects(api.prepare(request, auth), {
    message: 'AI_OFFLINE_HANDOFF_UNAVAILABLE'
  });
  await assert.rejects(api.review(request, auth, candidate));
});

test('offline display uses text nodes and clears stale private results', async () => {
  const context = {};
  vm.runInNewContext(
    await readFile('novelight-ai-review-result.js', 'utf8'),
    context
  );
  const doc = {
    createElement(tag) {
      return {
        tag,
        ownerDocument: doc,
        childNodes: [],
        textContent: '',
        appendChild(node) {
          this.childNodes.push(node);
        },
        replaceChildren() {
          this.childNodes = [];
        }
      };
    }
  };
  const container = doc.createElement('div');
  const api = context.NovelightAiReviewResult;
  const payload = '<img src=x onerror=alert(1)>';
  assert.equal(
    api.render(container, {
      result: {
        kind: 'proposed_edits',
        items: [{ quote: payload, replacement: '案', token: 'SECRET' }]
      }
    }),
    true
  );
  const flattened = JSON.stringify(container.childNodes, (key, value) =>
    key === 'ownerDocument' ? undefined : value
  );
  assert.ok(flattened.includes(payload));
  assert.ok(!flattened.includes('SECRET'));
  assert.ok(!flattened.includes('"tag":"img"'));
  assert.equal(api.render(container, null), false);
  assert.equal(container.childNodes.length, 0);
});
