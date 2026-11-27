// Offline only. The caller must verify the author and current comment feed
// from the authoritative server. Never accept feed rows from request JSON.
import { createHash } from 'node:crypto';
import { assertAiWorkAccess } from './context.js';

const KINDS = ['positive', 'concern', 'question', 'topic', 'spoiler_candidate'];

function invalid() {
  throw new Error('AI_OFFLINE_COMMENT_INVALID');
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

function id(value) {
  if (typeof value !== 'string') invalid();
  if (!/^[1-9][0-9]{0,19}$/u.test(value)) invalid();
  return value;
}

function sourceRows({ principal, novel, comments }) {
  assertAiWorkAccess({ principal, novel, audience: 'author' });
  if (!Array.isArray(comments) || comments.length > 50) invalid();
  const seen = new Set();
  const eligible = new Map();
  for (const row of comments) {
    const commentId = id(row?.id);
    if (seen.has(commentId)) invalid();
    seen.add(commentId);
    if (String(row.novel_id) !== String(novel.id)) invalid();
    if (row.can_moderate !== true || row.is_hidden !== false) continue;
    if (row.is_spoiler !== false) continue;
    const body = text(row.body, 4000);
    const sourceHash = createHash('sha256')
      .update(JSON.stringify([commentId, body]))
      .digest('hex');
    eligible.set(commentId, { commentId, body, sourceHash });
  }
  return eligible;
}

function parse(textValue, keys) {
  if (typeof textValue !== 'string') invalid();
  if (Buffer.byteLength(textValue, 'utf8') > 12000) invalid();
  let output;
  try {
    output = JSON.parse(textValue);
  } catch {
    invalid();
  }
  exactFields(output, keys);
  return output;
}

// Candidate classifications are not human-confirmed sentiment. Counts are
// calculated only from the cited eligible records, not from model claims.
export function reviewCommentTopics(input) {
  const rows = sourceRows(input);
  const result = parse(input.modelText, ['items']);
  if (!Array.isArray(result.items) || result.items.length > 12) invalid();
  const seen = new Set();
  const items = result.items.map((item) => {
    exactFields(item, ['kind', 'commentId', 'offset', 'quote']);
    if (!KINDS.includes(item.kind)) invalid();
    const row = rows.get(id(item.commentId));
    if (!row) invalid();
    const quote = text(item.quote, 160);
    const offset = item.offset;
    if (!Number.isSafeInteger(offset) || offset < 0) invalid();
    if (row.body.slice(offset, offset + quote.length) !== quote) invalid();
    const key = JSON.stringify([item.kind, row.commentId]);
    if (seen.has(key)) invalid();
    seen.add(key);
    return {
      kind: item.kind,
      commentId: row.commentId,
      sourceHash: row.sourceHash,
      offset,
      quote
    };
  });
  return {
    kind: 'comment_review_candidates',
    eligibleCount: rows.size,
    candidateCount: new Set(items.map((item) => item.commentId)).size,
    requiresAuthorReview: true,
    items
  };
}

// One draft only, tied to the original comment body. No sender, recipient,
// publish command or automatic insertion. The expected digest is trusted.
export function reviewCommentReply(input) {
  const rows = sourceRows(input);
  const row = rows.get(id(input.commentId));
  if (!row || row.sourceHash !== input.expectedSourceHash) invalid();
  const output = parse(input.modelText, ['reply']);
  return {
    kind: 'reply_draft',
    commentId: row.commentId,
    sourceHash: row.sourceHash,
    reply: text(output.reply, 1000),
    requiresAuthorReview: true
  };
}
