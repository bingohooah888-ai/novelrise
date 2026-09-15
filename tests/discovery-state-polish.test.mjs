import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const script = await readFile('novelight-discovery-state-polish.js', 'utf8');
const pages = await Promise.all(
  ['recommended.html', 'new-arrivals.html', 'light-seed.html'].map((path) =>
    readFile(path, 'utf8')
  )
);

test('discovery list pages load the state polish after the data loader', () => {
  for (const page of pages) {
    const dataLoader = page.indexOf('novelight-discovery-list.js');
    const statePolish = page.indexOf('novelight-discovery-state-polish.js');
    assert.ok(dataLoader >= 0);
    assert.ok(statePolish > dataLoader);
  }
});

test('discovery state polish provides mode-specific empty guidance', () => {
  assert.match(script, /おすすめできる公開作品がまだありません/);
  assert.match(script, /まだ公開された作品がありません/);
  assert.match(script, /LIGHT SEEDで発掘中の作品はまだありません/);
  assert.match(script, /作品を投稿する/);
  assert.match(script, /新着作品を見る/);
});

test('discovery load errors expose an in-place retry without owning data access', () => {
  assert.match(script, /作品を読み込めませんでした/);
  assert.match(script, /もう一度読み込む/);
  assert.match(script, /moreButton\.click\(\)/);
  assert.match(script, /MutationObserver/);
  assert.doesNotMatch(script, /supabase\.createClient/);
  assert.doesNotMatch(script, /\.rpc\(/);
  assert.doesNotMatch(script, /\.from\(/);
});
