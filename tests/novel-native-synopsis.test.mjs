import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';
import vm from 'node:vm';

const read = (path) =>
  readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const page = read('novel.html');
const template = read('api/seo/templates/novel.html');
const source = read('novelight-synopsis-fold.js');

function renderSynopsis(value) {
  const start = page.indexOf('function novelSynopsisMarkup(value)');
  const end = page.indexOf('function renderNovel(){', start);
  assert.ok(start > 0 && end > start);
  const context = {
    esc: (v) =>
      String(v).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  };
  return vm.runInNewContext(
    page.slice(start, end) + '\nnovelSynopsisMarkup(input)',
    { ...context, input: value }
  );
}

test('long synopsis has native full-text control', () => {
  const description = 'あらすじ\n' + '本文の紹介です。\n'.repeat(45);
  const rendered = renderSynopsis(description);
  assert.match(rendered, /<details class="novelight-native-synopsis">/u);
  assert.match(rendered, /あらすじをもっと見る ▼/u);
  assert.match(rendered, /閉じる ▲/u);
  assert.ok(
    rendered.includes('<div class="description">' + description + '</div>')
  );
  assert.match(
    page,
    /#novelHeader \.novelight-native-synopsis>\.description\{[^}]*overflow:visible!important/u
  );
});

test('short synopsis is fully visible', () => {
  const rendered = renderSynopsis('短いあらすじです。');
  assert.equal(rendered, '<div class="description">短いあらすじです。</div>');
});

test('synopsis escapes HTML and preserves content gate', () => {
  const value = '<img src=x onerror=alert(1)>'.repeat(10);
  const rendered = renderSynopsis(value);
  assert.doesNotMatch(rendered, /<img /u);
  assert.match(rendered, /&lt;img /u);
  assert.match(
    page,
    /renderNovel\(\)[\s\S]*novelSynopsisMarkup\(novel\.description\)/u
  );
  assert.match(
    page,
    /if\(!isOwner\(\)&&needsWarningGate\(\)&&!warningAccepted\(\)\)/u
  );
});

test('legacy script skips native details', () => {
  assert.match(
    source,
    /description && !description\.closest\('\.novelight-native-synopsis'\)/u
  );
  assert.match(page, /<summary>/u);
  assert.match(page, /novelight-native-synopsis\[open\]/u);
});

test('canonical novel SEO shell stays byte-identical', () => {
  assert.equal(page, template);
});
