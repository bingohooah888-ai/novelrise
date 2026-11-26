import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync('novelight-private-story-package.js', 'utf8');
const page = readFileSync('story-notes.html', 'utf8');
const context = { window: {} };
vm.runInNewContext(source, context);
const api = context.window.NovelightPrivateStoryPackage;

test('private package includes only author-selected saved categories', () => {
  const notes = [
    { note_type: 'plot', title: '序章', body: '展開' },
    { note_type: 'world', title: '世界', body: '秘密' }
  ];
  const before = JSON.stringify(notes);
  const result = api.buildPackage({
    title: '作品',
    notes,
    selected: ['plot']
  });
  assert.equal(result.count, 1);
  assert.match(result.text, /非公開・作者用作品資料/u);
  assert.match(result.text, /序章/u);
  assert.doesNotMatch(result.text, /秘密/u);
  assert.equal(JSON.stringify(notes), before);
});

test('private package preserves character notes and literal content', () => {
  const result = api.buildPackage({
    title: '作品',
    notes: [
      {
        note_type: 'character',
        title: '人物設定',
        body: '<script>本文</script>',
        character_name: null
      }
    ],
    selected: ['character']
  });
  assert.match(result.text, /登録解除済み/u);
  assert.match(result.text, /<script>本文<\/script>/u);
});

test('empty, unsupported and oversized packages fail closed', () => {
  const input = { title: '作品', notes: [], selected: ['plot'] };
  assert.equal(api.buildPackage(input), null);
  assert.equal(api.buildPackage({ ...input, selected: ['all'] }), null);
  const note = { note_type: 'plot', title: 'a', body: 'x'.repeat(4000001) };
  assert.equal(api.buildPackage({ ...input, notes: [note] }), null);
});

test('export requires the same authenticated session and explicit choice', () => {
  const session = { user: { id: 'author' }, access_token: 'synthetic' };
  assert.equal(api.sameOwner(session, session), true);
  assert.equal(api.sameOwner(session, null), false);
  assert.equal(api.sameOwner(null, session), false);
  const other = { ...session, user: { id: 'other' } };
  assert.equal(api.sameOwner(session, other), false);
  const refreshed = { ...session, access_token: 'changed' };
  assert.equal(api.sameOwner(session, refreshed), false);
  assert.match(page, /id="storyPackage" hidden/u);
  assert.match(page, /window\.confirm\(/u);
  assert.match(page, /sameOwner\(packageOwnerSession,current\.data/u);
  assert.match(page, /URL\.revokeObjectURL\(url\)/u);
  assert.doesNotMatch(source, /fetch\(|\.rpc\(|innerHTML|localStorage/u);
});
