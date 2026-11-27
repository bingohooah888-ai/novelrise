// Offline output selection only. The future caller must authorize the
// operation and capture the current official/public, eligible source set.
// No provider, API route, network, publication, exposure or scoring changes.
import { createHash } from 'node:crypto';

const REQUIRED = ['background', 'base_book'];
const LAYERS = [...REQUIRED, 'pattern', 'symbol', 'frame'];
const FIELDS = ['title', 'description', 'genre', 'tag'];

function invalid() {
  throw new Error('AI_OFFLINE_SELECTION_INVALID');
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

function key(value) {
  const result = text(value, 100);
  if (!/^[A-Za-z0-9_-]+$/u.test(result)) invalid();
  return result;
}

function requireDigest(snapshot, expectedHash) {
  if (typeof expectedHash !== 'string') invalid();
  if (!/^[a-f0-9]{64}$/u.test(expectedHash)) invalid();
  const actual = createHash('sha256')
    .update(JSON.stringify(snapshot))
    .digest('hex');
  if (actual !== expectedHash) invalid();
}

function parse(modelText, keys) {
  if (typeof modelText !== 'string') invalid();
  if (Buffer.byteLength(modelText, 'utf8') > 10000) invalid();
  let result;
  try {
    result = JSON.parse(modelText);
  } catch {
    invalid();
  }
  exactFields(result, keys);
  return result;
}

// The source must be the same template snapshot validated by the existing
// Geometry Thumbnail Engine. Only official author-visible layers are
// selectable. The server must recheck availability at actual adoption.
export function reviewOfficialThumbnail({ snapshot, expectedHash, modelText }) {
  exactFields(snapshot, ['templateKey', 'assets']);
  const templateKey = key(snapshot.templateKey);
  if (!Array.isArray(snapshot.assets) || snapshot.assets.length > 3000) {
    invalid();
  }
  const assets = new Map();
  for (const row of snapshot.assets) {
    exactFields(row, [
      'id',
      'template_key',
      'layer_type',
      'availability_status'
    ]);
    const assetId = key(row.id);
    if (assets.has(assetId)) invalid();
    assets.set(assetId, row);
  }
  requireDigest(snapshot, expectedHash);
  const output = parse(modelText, ['templateKey', 'selections']);
  if (output.templateKey !== templateKey) invalid();
  if (!Array.isArray(output.selections)) invalid();
  if (output.selections.length > LAYERS.length) invalid();
  const used = new Set();
  const selections = output.selections.map((item) => {
    exactFields(item, ['layer', 'assetId']);
    if (!LAYERS.includes(item.layer) || used.has(item.layer)) invalid();
    const row = assets.get(key(item.assetId));
    if (!row || row.template_key !== templateKey) invalid();
    if (row.layer_type !== item.layer) invalid();
    if (row.availability_status !== 'active') invalid();
    used.add(item.layer);
    return { layer: item.layer, assetId: row.id };
  });
  if (!REQUIRED.every((layer) => used.has(layer))) invalid();
  return {
    kind: 'official_material_candidates',
    templateKey,
    requiresAuthorReview: true,
    selections
  };
}

// The trusted caller must choose current, approved public help passages.
// Returning exact existing text avoids model-generated policy or prices.
export function reviewFaqSelection({ topics, expectedHash, modelText }) {
  if (!Array.isArray(topics) || topics.length > 80) invalid();
  const catalog = new Map();
  for (const topic of topics) {
    exactFields(topic, ['key', 'title', 'summary', 'points']);
    const topicKey = key(topic.key);
    if (catalog.has(topicKey)) invalid();
    text(topic.title, 200);
    text(topic.summary, 1200);
    if (!Array.isArray(topic.points) || topic.points.length > 30) invalid();
    for (const point of topic.points) text(point, 1200);
    catalog.set(topicKey, topic);
  }
  requireDigest(topics, expectedHash);
  const output = parse(modelText, ['items']);
  if (!Array.isArray(output.items) || output.items.length > 5) invalid();
  const used = new Set();
  const items = output.items.map((item) => {
    exactFields(item, ['key', 'part', 'index']);
    const topic = catalog.get(key(item.key));
    if (!topic || !Number.isSafeInteger(item.index)) invalid();
    let quote;
    if (item.part === 'summary' && item.index === 0) {
      quote = topic.summary;
    } else if (item.part === 'point' && item.index >= 0) {
      quote = topic.points[item.index];
    }
    if (!quote) invalid();
    const identity = JSON.stringify([item.key, item.part, item.index]);
    if (used.has(identity)) invalid();
    used.add(identity);
    return { title: topic.title, quote, href: 'help.html#' + topic.key };
  });
  return {
    kind: 'official_help_excerpts',
    items,
    fallbackHref: items.length ? null : 'contact.html'
  };
}

// The input is the already authorized, age-filtered and hidden-work-filtered
// public candidate set, in its original order. No new fetch or rank mutation.
// Model-supplied scores, claims and URLs are deliberately not accepted.
export function reviewDiscoverySelection({ rows, expectedHash, modelText }) {
  if (!Array.isArray(rows) || rows.length > 100) invalid();
  const catalog = new Map();
  for (const row of rows) {
    exactFields(row, ['novelId', 'title', 'description', 'genre', 'tags']);
    const novelId = text(row.novelId, 20);
    if (!/^[1-9][0-9]*$/u.test(novelId) || catalog.has(novelId)) invalid();
    text(row.title, 200);
    if (typeof row.description !== 'string') invalid();
    if (row.description.length > 2000) invalid();
    if (typeof row.genre !== 'string' || row.genre.length > 100) invalid();
    if (!Array.isArray(row.tags) || row.tags.length > 20) invalid();
    for (const tag of row.tags) text(tag, 80);
    catalog.set(novelId, row);
  }
  requireDigest(rows, expectedHash);
  const output = parse(modelText, ['items']);
  if (!Array.isArray(output.items) || output.items.length > 12) invalid();
  const matches = new Map();
  for (const item of output.items) {
    exactFields(item, ['novelId', 'field', 'quote']);
    const row = catalog.get(item.novelId);
    if (!row || matches.has(item.novelId)) invalid();
    if (!FIELDS.includes(item.field)) invalid();
    const quote = text(item.quote, 120);
    const found =
      item.field === 'tag'
        ? row.tags.includes(quote)
        : row[item.field].includes(quote);
    if (!found) invalid();
    matches.set(item.novelId, { field: item.field, quote });
  }
  const items = rows
    .filter((row) => matches.has(row.novelId))
    .map((row) => ({
      novelId: row.novelId,
      title: row.title,
      ...matches.get(row.novelId)
    }));
  return { kind: 'public_metadata_matches', items };
}
