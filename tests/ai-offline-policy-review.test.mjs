import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { reviewPolicyEvidence } from '../api/_lib/ai/offline-policy-review.js';

const digest = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const policyQuote = '区分の意図的な虚偽申告は禁止します。';
const policy = [{ section: '5', body: policyQuote }];
const subject = { id: '42', body: '架空の確認対象：区分を選択した。' };
const item = {
  section: '5',
  policyQuote,
  offset: 0,
  quote: '架空の確認対象'
};
const input = {
  policy,
  subject,
  expectedPolicyHash: digest(policy),
  expectedSubjectHash: digest(subject),
  modelText: JSON.stringify({ items: [item] })
};

test('policy evidence uses published wording and remains advisory', async () => {
  const html = await readFile('content-guidelines.html', 'utf8');
  assert.ok(html.includes(policyQuote));
  const result = reviewPolicyEvidence(input);
  assert.equal(result.requiresHumanReview, true);
  assert.equal(result.violationVerified, false);
  assert.equal(result.items[0].policyQuote, policyQuote);
  assert.equal(result.items[0].quote, item.quote);
  assert.ok(!Object.hasOwn(result, 'action'));
});

test('changed source and policy snapshots fail closed', () => {
  assert.throws(() =>
    reviewPolicyEvidence({
      ...input,
      subject: { ...subject, body: subject.body + '改訂' }
    })
  );
  assert.throws(() =>
    reviewPolicyEvidence({
      ...input,
      policy: [{ ...policy[0], body: policyQuote + '改訂' }]
    })
  );
});

test('fabricated policy and evidence or action fields fail closed', () => {
  const invalid = [
    { ...item, section: '9' },
    { ...item, policyQuote: '架空の規約' },
    { ...item, quote: '架空の引用' },
    { ...item, offset: 1 },
    { ...item, action: 'delete' }
  ];
  for (const candidate of invalid) {
    const modelText = JSON.stringify({ items: [candidate] });
    assert.throws(() => reviewPolicyEvidence({ ...input, modelText }));
  }
  const modelText = JSON.stringify({ items: [item, item] });
  assert.throws(() => reviewPolicyEvidence({ ...input, modelText }));
});
