import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const page = readFileSync('novel.html', 'utf8');
const seo = readFileSync('api/seo/templates/novel.html', 'utf8');
const runtime = readFileSync('novelight-synopsis-fold.js', 'utf8');
const source = page.match(/^function novelSynopsisMarkup\(value\).*$/mu)?.[0];
const esc = (value) => String(value).replaceAll('<', '&lt;');

function render(value) {
  return vm.runInNewContext(source + '\nnovelSynopsisMarkup(value)', {
    esc,
    value
  });
}

test('long synopsis has a native button and full text', () => {
  const full = 'あらすじ\n' + '物語の紹介です。\n'.repeat(50);
  const html = render(full);
  assert.match(html, /<details class="novelight-native-synopsis">/u);
  assert.match(html, /あらすじをもっと見る ▼/u);
  assert.ok(html.includes('<div class="description">' + full + '</div>'));
});

test('short synopsis shows full text without folding', () => {
  const html = render('短いあらすじです。');
  assert.equal(html, '<div class="description">短いあらすじです。</div>');
});

test('native synopsis is safe and not double-folded', () => {
  const html = render('<img>'.repeat(60));
  assert.doesNotMatch(html, /<img>/u);
  assert.match(html, /&lt;img>/u);
  assert.match(runtime, /!description\.closest/u);
});

test('SEO shell remains identical and native control is wired', () => {
  assert.equal(page, seo);
  assert.match(page, /novelSynopsisMarkup\(novel\.description\)/u);
  assert.match(page, /novelight-native-synopsis\[open\]/u);
});
