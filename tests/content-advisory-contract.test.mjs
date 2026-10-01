import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [novel, episode, detail] = await Promise.all([
  readFile(new URL('../novel.html', import.meta.url), 'utf8'),
  readFile(new URL('../episode.html', import.meta.url), 'utf8'),
  readFile(new URL('../novelight-novel-detail.js', import.meta.url), 'utf8')
]);

test('ordinary content warnings are passive while only R15/R18 are gated', () => {
  for (const source of [novel, episode]) {
    assert.match(source, /rating==='sensitive_15'\|\|rating==='adult_18_nonsexual'/u);
    assert.match(source, /contentAdvisoryMarkup/u);
    assert.match(source, /が含まれます/u);
  }
  assert.doesNotMatch(novel, /normalizedRating\(\)!=='general'\|\|\(novel\?\.content_warnings/u);
  assert.doesNotMatch(episode, /content_rating==='mature'\|\|\(novel\.content_warnings/u);
});

test('work and episode share one per-work age acknowledgement contract', () => {
  const key = "novelight:age-gate:novel:";
  for (const source of [novel, episode]) {
    assert.ok(source.includes(key));
    assert.match(source, /localStorage\.getItem\(key\)/u);
    assert.match(source, /sessionStorage\.getItem\(key\)/u);
    assert.match(source, /sessionStorage\.setItem\(key,'1'\)/u);
    assert.match(source, /localStorage\.setItem\(key,'1'\)/u);
    assert.ok(source.includes('この作品では今後この確認を表示しない'));
    assert.match(source, /id="rememberWarning" type="checkbox" checked/u);
    assert.match(source, /content_rating==='mature'\?'sensitive_15'/u);
  }
});

test('R18 keeps explicit age wording and passive advisory survives detail V2', () => {
  for (const source of [novel, episode]) {
    assert.ok(source.includes('18歳以上'));
    assert.ok(source.includes("items.push('R18')"));
  }
  assert.ok(detail.includes("header?.querySelector('#contentAdvisory')"));
  assert.ok(detail.includes('if (advisory) main.appendChild(advisory);'));
});
