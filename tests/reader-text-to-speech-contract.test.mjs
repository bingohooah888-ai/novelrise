import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const episodeUrl = new URL('../episode.html', import.meta.url);
const scriptUrl = new URL('../novelight-reader-tts.js', import.meta.url);
const settingsUrl = new URL(
  '../novelight-reading-settings.js',
  import.meta.url
);
const text = (url) => readFile(url, 'utf8');

await import(scriptUrl);
const readerTts = globalThis.NovelightReaderTts;

test('reader TTS splits long body text into bounded chunks in reading order', () => {
  const source = `第一段落。\n${'長い本文'.repeat(100)}。\n最終段落。`;
  const chunks = readerTts.chunksFor(source);
  assert.equal(chunks[0], '第一段落。');
  assert.equal(chunks.at(-1), '最終段落。');
  assert.ok(
    chunks.every((chunk) => chunk.length <= readerTts.MAX_CHUNK_LENGTH)
  );
  assert.equal(chunks.join('').replaceAll(' ', ''), source.replace(/\s/gu, ''));
});

test('reader TTS keeps a chunk bounded when punctuation is exactly after the boundary', () => {
  const source = `${'あ'.repeat(readerTts.MAX_CHUNK_LENGTH)}。続き。`;
  const chunks = readerTts.chunksFor(source);

  assert.equal(chunks[0].length, readerTts.MAX_CHUNK_LENGTH);
  assert.ok(
    chunks.every((chunk) => chunk.length <= readerTts.MAX_CHUNK_LENGTH)
  );
  assert.equal(chunks.join(''), source);
});

test('reader TTS selects only a Japanese voice and otherwise leaves browser fallback intact', () => {
  const english = { lang: 'en-US' };
  const japanese = { lang: 'ja-JP' };
  assert.equal(
    readerTts.preferredVoice({ getVoices: () => [english, japanese] }),
    japanese
  );
  assert.equal(readerTts.preferredVoice({ getVoices: () => [english] }), null);
  assert.equal(readerTts.preferredVoice({ getVoices: () => [] }), null);
});

test('reader TTS normalizes prose before text extraction and cancels before remount', async () => {
  const script = await text(scriptUrl);

  assert.match(
    script,
    /mountedController\?\.cancel\(\);[\s\S]*content\.dataset\.ttsMounted = 'true'/u
  );
  assert.match(
    script,
    /global\.NovelightProse\?\.enhance\(content\);\s*const text = displayedText\(content\);/u
  );
});

test('displayed reader text keeps ruby base text and omits its annotation', () => {
  const textNode = (nodeValue) => ({ nodeType: 3, nodeValue });
  const element = (tagName, childNodes = []) => ({
    nodeType: 1,
    tagName,
    childNodes,
    hidden: false,
    getAttribute: () => null
  });
  const root = element('DIV', [
    textNode('朝、'),
    element('RUBY', [
      textNode('東京'),
      element('RP', [textNode('（')]),
      element('RT', [textNode('とうきょう')]),
      element('RP', [textNode('）')])
    ]),
    textNode('へ向かった。')
  ]);

  assert.equal(readerTts.displayedText(root), '朝、東京へ向かった。');
});

test('episode integrates explicit accessible TTS controls without autoplay', async () => {
  const [episode, script, settings] = await Promise.all([
    text(episodeUrl),
    text(scriptUrl),
    text(settingsUrl)
  ]);
  assert.match(episode, /NovelightReadingSettings\.mount\(\)/);
  assert.match(settings, /novelight-reader-tts\.css/);
  assert.match(settings, /novelight-reader-tts\.js/);
  assert.match(script, /\.novelight-page-episode \.content/);
  for (const action of ['start', 'pause', 'resume', 'stop']) {
    assert.match(script, new RegExp(`data-tts-action="${action}"`));
  }
  assert.match(script, /role="status" aria-live="polite"/);
  assert.match(script, /このブラウザは本文の読み上げに対応していません/);
});

test('reader TTS is browser-local, skips ruby annotations, and cancels on exit', async () => {
  const script = await text(scriptUrl);
  assert.match(script, /'RT'/);
  assert.match(script, /'RP'/);
  assert.match(script, /speechSynthesis/);
  assert.match(script, /SpeechSynthesisUtterance/);
  assert.match(script, /pagehide/);
  assert.match(script, /beforeunload/);
  assert.match(script, /synthesis\.cancel\(\)/);
  assert.doesNotMatch(
    script,
    /supabase|\.rpc\(|fetch\(|XMLHttpRequest|analytics/i
  );
});
