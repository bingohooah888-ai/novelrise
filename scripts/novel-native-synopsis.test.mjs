import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const detail = readFileSync(new URL('../novelight-novel-detail.js', import.meta.url), 'utf8');
const fold = readFileSync(new URL('../novelight-synopsis-fold.js', import.meta.url), 'utf8');

test('work detail transfers the complete native synopsis disclosure', () => {
  assert.ok(detail.includes("querySelector('.novelight-native-synopsis')"));
  assert.ok(detail.includes('synopsis.append('));
  assert.ok(detail.includes('description);'));
  assert.ok(detail.includes('.nl-work-detail-synopsis .novelight-native-synopsis-preview'));
  assert.ok(detail.includes('.nl-work-detail-synopsis .novelight-native-synopsis[open]'));
});

test('work detail retains title, author, tags and reading metadata', () => {
  assert.ok(detail.includes('main.append(title)'));
  assert.ok(detail.includes('main.append(author, meta)'));
  assert.ok(detail.includes('left.append(cover, tags)'));
  assert.ok(!fold.includes("querySelectorAll('.nl-work-detail-bookmeta').forEach"));
  assert.ok(!fold.includes("querySelectorAll('.novelight-work-tag,.nl-work-tag-more')"));
  assert.ok(!fold.includes("'.nl-work-detail-bookmeta{display:none!important;}'"));
});

test('owner draft count is not reported as published', () => {
  assert.ok(fold.includes("row.dataset.episodeStatus !== 'draft'"));
  assert.ok(fold.includes("row.dataset.episodeStatus === 'draft'"));
});
