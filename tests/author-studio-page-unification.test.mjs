import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const pagePaths = [
  'post.html',
  'my-novels.html',
  'author-notes.html',
  'analytics.html',
  'interaction-settings.html',
  'account-settings.html'
];

const pages = await Promise.all(
  pagePaths.map((path) => readFile(path, 'utf8'))
);
const styles = await readFile('novelight-author-studio-pages.css', 'utf8');

test('target creator pages share the Author Studio presentation layer', () => {
  for (const source of pages) {
    assert.ok(source.includes('novelight-author-studio-pages.css'));
    assert.ok(source.includes('novelight-author-ui'));
  }
});

test('shared typography follows the SCOUT RECORD readability scale', () => {
  assert.ok(styles.includes('font-size: clamp(32px, 4vw, 52px)'));
  assert.ok(styles.includes('font-size: 18px'));
  assert.ok(styles.includes('font-size: 28px'));
  assert.ok(styles.includes('font-size: 16px'));
  assert.ok(styles.includes('font-size: 15px'));
});

test('shared surface keeps the Author Notes dark panel pattern', () => {
  assert.ok(styles.includes('--novelight-studio-bg: #07121e'));
  assert.ok(styles.includes('--novelight-studio-panel:'));
  assert.ok(styles.includes('border-radius: 18px'));
  assert.ok(styles.includes('--novelight-studio-line:'));
  assert.ok(styles.includes('--novelight-studio-input: #091824'));
});

test('desktop and mobile presentation rules are both defined', () => {
  assert.ok(styles.includes('@media (max-width: 900px)'));
  assert.ok(styles.includes('@media (max-width: 700px)'));
  assert.ok(styles.includes('@media (max-width: 640px)'));
  assert.ok(styles.includes('font-size: 30px'));
  assert.ok(styles.includes('font-size: 17px'));
  assert.ok(styles.includes('font-size: 24px'));
});
