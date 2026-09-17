import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const proseUrl = new URL('../novelight-prose.js', import.meta.url);
const readingSettingsUrl = new URL('../novelight-reading-settings.js', import.meta.url);
const authorDraftUrl = new URL('../novelight-author-draft.js', import.meta.url);

async function text(url) {
  return readFile(url, 'utf8');
}

await import(proseUrl);
const prose = globalThis.NovelightProse;

test('safe prose tokenizer recognizes only bounded ruby and emphasis syntax', () => {
  assert.ok(prose);
  assert.deepEqual(prose.tokenize('前｜東京《とうきょう》中'), [
    { type: 'text', text: '前' },
    { type: 'ruby', base: '東京', reading: 'とうきょう' },
    { type: 'text', text: '中' }
  ]);
  assert.deepEqual(prose.tokenize('前《《大事》》後'), [
    { type: 'text', text: '前' },
    { type: 'emphasis', text: '大事' },
    { type: 'text', text: '後' }
  ]);
});

test('malformed markup and html-looking manuscript remain plain text tokens', () => {
  assert.deepEqual(prose.tokenize('｜東京《とうきょう'), [
    { type: 'text', text: '｜東京《とうきょう' }
  ]);
  assert.deepEqual(prose.tokenize('<img src=x onerror=alert(1)>'), [
    { type: 'text', text: '<img src=x onerror=alert(1)>' }
  ]);
  assert.deepEqual(prose.tokenize('｜<b>東京</b>《とうきょう》'), [
    { type: 'ruby', base: '<b>東京</b>', reading: 'とうきょう' }
  ]);
});

test('oversized or multiline prose markup fails closed to literal text', () => {
  const longEmphasis = `《《${'あ'.repeat(prose.LIMITS.emphasis + 1)}》》`;
  const longRuby = `｜${'漢'.repeat(prose.LIMITS.rubyBase + 1)}《かん》`;
  const multilineRuby = '｜東京\n駅《とうきょうえき》';

  assert.deepEqual(prose.tokenize(longEmphasis), [{ type: 'text', text: longEmphasis }]);
  assert.deepEqual(prose.tokenize(longRuby), [{ type: 'text', text: longRuby }]);
  assert.deepEqual(prose.tokenize(multilineRuby), [{ type: 'text', text: multilineRuby }]);
});

test('renderer builds allowlisted DOM nodes and never parses manuscript as html', async () => {
  const source = await text(proseUrl);

  assert.match(source, /createElement\('ruby'\)/);
  assert.match(source, /createElement\('rt'\)/);
  assert.match(source, /createElement\('span'\)/);
  assert.match(source, /createTextNode\(/);
  assert.match(source, /\.textContent\s*=/);
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|DOMParser|eval\(|new Function/);
  assert.doesNotMatch(source, /supabase|\.rpc\(|fetch\(|XMLHttpRequest/);
});

test('episode reader and author preview load the same safe renderer', async () => {
  const [readingSettings, authorDraft] = await Promise.all([
    text(readingSettingsUrl),
    text(authorDraftUrl)
  ]);

  assert.match(readingSettings, /script\.src = 'novelight-prose\.js'/);
  assert.match(readingSettings, /dataset\.novelightProse/);
  assert.match(authorDraft, /script\.src = 'novelight-prose\.js'/);
  assert.match(authorDraft, /dataset\.novelightProse/);
  assert.match(authorDraft, /NovelightProse\?\.enhance\(modal\)/);
  assert.match(authorDraft, /｜漢字《かんじ》/);
  assert.match(authorDraft, /《《強調》》/);
  assert.match(authorDraft, /任意のHTMLは実行されず文字として表示されます/);
});
