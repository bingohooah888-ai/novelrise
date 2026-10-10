import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';

const mediaShare = await readFile(
  new URL('../novelight-x-image-share.js', import.meta.url),
  'utf8'
);
const workDetail = await readFile(
  new URL('../novelight-novel-detail.js', import.meta.url),
  'utf8'
);

test('X media sharing prioritizes author and published work covers', () => {
  assert.match(mediaShare, /novel_thumbnail_assets/u);
  assert.match(mediaShare, /add\(asset\.data\?\.image_url\)/u);
  assert.match(mediaShare, /add\(novel\.thumbnail_url\)/u);
  assert.match(mediaShare, /add\(row\?\.render_url\)/u);
});

test('NOVELIGHT default image replaces missing or unreadable covers', () => {
  assert.match(mediaShare, /defaultCoverPng/u);
  assert.match(mediaShare, /#071221/u);
  assert.match(mediaShare, /NOVELIGHT/u);
  assert.match(mediaShare, /catch \(error\)/u);
});

test('mobile Web Share includes image, title, and URL', () => {
  assert.match(mediaShare, /navigator\.canShare/u);
  assert.match(mediaShare, /navigator\.share\(payload\)/u);
  assert.match(mediaShare, /files: \[file\]/u);
});

test('desktop image clipboard and X composer work together', () => {
  assert.match(mediaShare, /navigator\.clipboard\.write/u);
  assert.match(mediaShare, /new ClipboardItem/u);
  assert.match(mediaShare, /popup\.location\.replace/u);
  assert.match(mediaShare, /downloadFile\(file\)/u);
});

test('work detail X button delegates to the image share runtime', () => {
  assert.match(workDetail, /NovelightXImageShare\.share/u);
  assert.match(workDetail, /event\.preventDefault\(\)/u);
});
