// Offline only: callers must independently authorize the admin and obtain
// canonical policy and subject snapshots on the server. No automatic action.
import { createHash } from 'node:crypto';

const SECTIONS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

function invalid() {
  throw new Error('AI_OFFLINE_POLICY_INVALID');
}

function exactFields(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  if (Object.keys(value).length !== keys.length) invalid();
  if (!keys.every((key) => Object.hasOwn(value, key))) invalid();
}

function text(value, max) {
  if (typeof value !== 'string' || !value.trim()) invalid();
  if (value.length > max) invalid();
  return value;
}

function hash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function requireDigest(value, expected) {
  if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/u.test(expected)) {
    invalid();
  }
  if (hash(value) !== expected) invalid();
}

// expected digests must come from the independently verified snapshot,
// never from model output or an untrusted request. Section bodies are the
// canonical plain-text passages, not a model-generated interpretation.
export function reviewPolicyEvidence({
  policy,
  subject,
  expectedPolicyHash,
  expectedSubjectHash,
  modelText
}) {
  if (!Array.isArray(policy) || policy.length > SECTIONS.length) invalid();
  if (!policy.length) invalid();
  const sections = new Map();
  for (const row of policy) {
    exactFields(row, ['section', 'body']);
    if (!SECTIONS.includes(row.section)) invalid();
    if (sections.has(row.section)) invalid();
    sections.set(row.section, text(row.body, 12000));
  }
  exactFields(subject, ['id', 'body']);
  if (typeof subject.id !== 'string') invalid();
  if (!/^[1-9][0-9]{0,19}$/u.test(subject.id)) invalid();
  const body = text(subject.body, 24000);
  requireDigest(policy, expectedPolicyHash);
  requireDigest(subject, expectedSubjectHash);
  if (typeof modelText !== 'string') invalid();
  if (Buffer.byteLength(modelText, 'utf8') > 12000) invalid();
  let parsed;
  try {
    parsed = JSON.parse(modelText);
  } catch {
    invalid();
  }
  exactFields(parsed, ['items']);
  if (!Array.isArray(parsed.items) || parsed.items.length > 8) invalid();
  const seen = new Set();
  const items = parsed.items.map((item) => {
    exactFields(item, ['section', 'policyQuote', 'offset', 'quote']);
    const policyBody = sections.get(item.section);
    if (!policyBody) invalid();
    const policyQuote = text(item.policyQuote, 240);
    if (!policyBody.includes(policyQuote)) invalid();
    const quote = text(item.quote, 240);
    const offset = item.offset;
    if (!Number.isSafeInteger(offset) || offset < 0) invalid();
    if (offset + quote.length > body.length) invalid();
    const actualQuote = body.slice(offset, offset + quote.length);
    if (actualQuote !== quote) invalid();
    const key = JSON.stringify([item.section, offset]);
    if (seen.has(key)) invalid();
    seen.add(key);
    return {
      section: item.section,
      policyQuote,
      offset,
      quote: actualQuote
    };
  });
  return {
    kind: 'policy_review_candidates',
    subjectId: subject.id,
    policyHash: expectedPolicyHash,
    subjectHash: expectedSubjectHash,
    requiresHumanReview: true,
    violationVerified: false,
    items
  };
}
