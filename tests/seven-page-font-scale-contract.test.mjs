import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const creatorPages = [
  'post.html',
  'my-novels.html',
  'author-notes.html',
  'analytics.html',
  'interaction-settings.html',
  'account-settings.html'
];

test('the typography scale stays inside the seven requested pages', async () => {
  for (const path of creatorPages) {
    const source = await readFile(path, 'utf8');
    assert.ok(source.includes('novelight-author-font-sizes.css'), path);
  }

  const scout = await readFile('scout-record.html', 'utf8');
  assert.ok(scout.includes('novelight-scout-record.css'));

  const creatorRoom = await readFile('mypage.html', 'utf8');
  assert.ok(!creatorRoom.includes('novelight-author-font-sizes.css'));
  assert.ok(!creatorRoom.includes('novelight-scout-record.css'));
});

test('creator typography CSS changes font size only and preserves page titles', async () => {
  const styles = await readFile('novelight-author-font-sizes.css', 'utf8');

  assert.match(styles, /font-size: clamp\(32px, 4vw, 52px\) !important;/u);
  assert.match(styles, /font-size: 30px !important;/u);

  const blocks = [...styles.matchAll(/\{([^{}]*)\}/gu)].map(
    (match) => match[1]
  );

  for (const block of blocks) {
    for (const declaration of block.split(';')) {
      const trimmed = declaration.trim();
      if (!trimmed || !trimmed.includes(':')) continue;
      const property = trimmed.slice(0, trimmed.indexOf(':')).trim();
      assert.equal(property, 'font-size', trimmed);
    }
  }
});

test('SCOUT page-title size stays untouched by the new role mapping', async () => {
  const styles = await readFile('novelight-scout-record.css', 'utf8');
  const marker =
    '/* Seven-page shared typography scale: SCOUT RECORD role mapping. */';
  const index = styles.indexOf(marker);

  assert.ok(index >= 0);
  const addedScale = styles.slice(index);
  assert.ok(!addedScale.includes('.scout-page-head h1'));
  assert.match(
    styles,
    /\.scout-page-head h1\{[^}]*font-size:clamp\(32px,4vw,52px\)/u
  );
  assert.match(styles, /\.scout-page-head h1\{font-size:30px\}/u);
});
