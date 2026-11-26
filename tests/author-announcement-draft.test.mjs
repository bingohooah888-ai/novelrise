import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const runtime = readFileSync('novelight-author-announcement-draft.js', 'utf8');
const page = readFileSync('author-notes.html', 'utf8');
const browser = { window: {} };
vm.runInNewContext(runtime, browser);
const { buildDraft, canInsert } = browser.window.NovelightAuthorAnnouncementDraft;
const fixture = { novelId: '42', novelTitle: '月夜の旅', detail: '作者のコメント' };

test('four announcement types use only selected work and author-supplied facts', () => {
  for (const kind of ['update', 'launch', 'complete', 'introduce']) {
    const draft = buildDraft({ ...fixture, kind });
    assert.ok(draft.title.length <= 80);
    assert.ok(draft.body.length <= 1000);
    assert.match(draft.body, /月夜の旅/);
    assert.match(draft.body, /作者のコメント/);
    assert.match(draft.social, /https:\/\/novelight\.jp\/novel\.html\?id=42/);
    assert.ok(Object.isFrozen(draft));
  }
  assert.match(buildDraft({ ...fixture, kind: 'complete' }).body, /完結しました/);
});

test('draft bounds reject unknown types, unsafe identifiers and oversized input', () => {
  for (const kind of ['constructor', 'toString', 'unknown']) {
    assert.equal(buildDraft({ ...fixture, kind }), null);
  }
  for (const novelId of ['', '0', '1&other=2', '9007199254740992']) {
    assert.equal(buildDraft({ ...fixture, kind: 'update', novelId }), null);
  }
  assert.equal(buildDraft({ ...fixture, kind: 'update', detail: 'a'.repeat(501) }), null);
  const draft = buildDraft({ ...fixture, kind: 'update', novelTitle: '長'.repeat(200) });
  assert.equal(draft.title, '更新のお知らせ');
  assert.match(draft.body, /長{200}/);
});

test('only an empty new note can receive a generated draft', () => {
  const empty = { ready: true, busy: false, noteId: '', title: '', body: '' };
  assert.equal(canInsert(empty), true);
  for (const patch of [
    { ready: false },
    { busy: true },
    { noteId: '12' },
    { title: '既存のタイトル' },
    { body: '既存の本文' },
    { body: ' ' }
  ]) {
    assert.equal(canInsert({ ...empty, ...patch }), false);
  }
});

test('existing owner note form remains the only publishing path', () => {
  assert.match(page, /novelight-author-announcement-draft\.js/u);
  assert.match(page, /id="announcementInsert" class="btn" type="button"/u);
  assert.match(page, /id="announcementSocial" class="btn" type="button"/u);
  assert.match(page, /id="announcementOutput" rows="5" readonly/u);
  assert.match(page, /if\(!ready\|\|busy\)return null/u);
  assert.match(page, /\.eq\('status','published'\)/u);
  assert.match(page, /title\.value=draft\.title;body\.value=draft\.body;updateCounts\(\)/u);
  assert.doesNotMatch(runtime, /\b(fetch|XMLHttpRequest|localStorage|sendBeacon)\s*\(/u);
  assert.doesNotMatch(runtime, /\.submit\(|\.rpc\(|innerHTML/u);
});

// TEMPORARY_FORMAT_DIAGNOSTIC_20261126
test('report installed formatter output for the changed public test file', async () => {
  const prettier = await import('prettier');
  const { readFile } = await import('node:fs/promises');
  const path = new URL(import.meta.url);
  const source = await readFile(path, 'utf8');
  const clean = source.split('// TEMPORARY_FORMAT_DIAGNOSTIC_20261126')[0].trimEnd() + '\n';
  const options = await prettier.resolveConfig(path.pathname);
  const formatted = await prettier.format(clean, {
    ...options,
    filepath: path.pathname
  });
  console.log('NOVELIGHT_FORMAT_VERSION ' + prettier.version);
  console.log('NOVELIGHT_FORMAT_FULL ' + JSON.stringify(formatted));
});
