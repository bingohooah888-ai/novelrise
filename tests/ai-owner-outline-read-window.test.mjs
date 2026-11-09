import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { validateOwnerOutlineReadWindow as check } from '../api/_lib/ai/owner-outline-read-window.js';
import '../novelight-ai-bible-owner-outline.js';
import '../novelight-ai-bible-author-workspace.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const access = () => ({
  verifiedActorId: OWNER,
  checkedNovelOwnerId: OWNER,
  checkedNovelId: 23,
  sessionBinding: 'synthetic-session-A'
});
const preview = () => ({
  novelId: 23,
  aiGenerated: false,
  characters: [],
  notes: [],
  facts: []
});
const rows = () => [
  {
    episode_id: 900,
    episode_number: 2,
    episode_title: '秘密の草稿',
    episode_status: 'draft',
    chapter_id: 12,
    chapter_title: '序章',
    chapter_position: 1
  },
  {
    episode_id: 100,
    episode_number: 7,
    episode_title: '公開章',
    episode_status: 'published',
    chapter_id: null,
    chapter_title: null,
    chapter_position: null
  }
];
function fixture(overrides = {}) {
  return {
    expectedNovelId: 23,
    preview: preview(),
    accessBefore: access(),
    accessAfter: access(),
    outlineBefore: rows(),
    outlineAfter: rows(),
    ...overrides
  };
}

test('same verified owner, work, session and unchanged snapshots permit an offline join', () => {
  const input = fixture();
  const result = check(input);
  assert.equal(result?.novelId, 23);
  assert.equal(result.outlineRows.length, 2);
  assert.equal(result.outlineRows[0].episode_id, 100);
  assert.equal(result.outlineRows[1].episode_id, 900);
  assert.equal(result.outlineRows[1].episode_number, 2);
  assert.equal(result.outlineRows[1].chapter_title, '序章');
  assert.equal(Object.hasOwn(result.outlineRows[1], 'episode_title'), false);
  assert.equal(Object.hasOwn(result.outlineRows[1], 'episode_status'), false);
  assert.equal(input.outlineAfter[0].episode_title, '秘密の草稿');
});

test('row ordering changes alone do not imply a stale outline', () => {
  const input = fixture();
  input.outlineAfter.reverse();
  assert.ok(check(input));
});

test('changed episode order, chapter, title, status, additions and deletions refuse stale join', () => {
  for (const changed of [
    (a) => {
      a[0].episode_number = 3;
    },
    (a) => {
      a[0].chapter_id = 13;
      a[0].chapter_title = '改訂章';
    },
    (a) => {
      a[0].chapter_title = '章の改名';
    },
    (a) => {
      a[0].chapter_position = 2;
    },
    (a) => {
      a[0].episode_title = '未公開タイトルの改稿';
    },
    (a) => {
      a[0].episode_status = 'published';
    },
    (a) => {
      a.pop();
    },
    (a) => {
      a.push({
        episode_id: 901,
        episode_number: 8,
        episode_title: '新話',
        episode_status: 'draft',
        chapter_id: null,
        chapter_title: null,
        chapter_position: null
      });
    }
  ]) {
    const input = fixture();
    changed(input.outlineAfter);
    assert.equal(check(input), null);
  }
});

test('account switch, session change and novel-ownership mismatch refuse private drafts', () => {
  const others = [
    { accessBefore: { ...access(), verifiedActorId: OTHER } },
    { accessAfter: { ...access(), verifiedActorId: OTHER } },
    { accessAfter: { ...access(), checkedNovelOwnerId: OTHER } },
    { accessAfter: { ...access(), checkedNovelId: 24 } },
    { accessAfter: { ...access(), sessionBinding: 'synthetic-session-B' } },
    { accessBefore: { ...access(), sessionBinding: '' } },
    { accessBefore: null },
    { accessAfter: null }
  ];
  for (const change of others) assert.equal(check(fixture(change)), null);
});

test('public preview or incorrect work cannot bypass owner-read contract', () => {
  const p = preview();
  for (const bad of [
    { ...p, novelId: 24 },
    { ...p, aiGenerated: true },
    { ...p, aiGenerated: undefined },
    { ...p, candidates: [] },
    { ...p, notes: null }
  ])
    assert.equal(check(fixture({ preview: bad })), null);
  assert.equal(check(fixture({ expectedNovelId: '23e0' })), null);
  assert.equal(check(fixture({ expectedNovelId: 24 })), null);
});

test('incomplete RPC payload and inconsistent chapter structures fail closed', () => {
  const bad = [
    (a) => {
      a[0].episode_id = 0;
    },
    (a) => {
      a[1].episode_id = 900;
    },
    (a) => {
      a[1].episode_number = 2;
    },
    (a) => {
      delete a[0].episode_status;
    },
    (a) => {
      a[0].chapter_id = undefined;
    },
    (a) => {
      a[1].chapter_title = 'wrong';
    },
    (a) => {
      a[0].chapter_position = -1;
    },
    (a) => {
      a[1].episode_title = null;
    },
    (a) => {
      a[0].episode_number = '2.0';
    }
  ];
  for (const mutate of bad) {
    const input = fixture();
    mutate(input.outlineBefore);
    mutate(input.outlineAfter);
    assert.equal(check(input), null);
  }
});

test('chapter ID reuse with conflicting chapter positions fails even with identical snapshots', () => {
  const input = fixture();
  const newRow = {
    episode_id: 901,
    episode_number: 9,
    episode_title: '別の章',
    episode_status: 'draft',
    chapter_id: 12,
    chapter_title: '序章',
    chapter_position: 2
  };
  input.outlineBefore.push({ ...newRow });
  input.outlineAfter.push({ ...newRow });
  assert.equal(check(input), null);
});

test('the contract is not mounted or a permission substitute', async () => {
  const source = await readFile(
    new URL('../api/_lib/ai/owner-outline-read-window.js', import.meta.url),
    'utf8'
  );
  assert.doesNotMatch(source, /fetch\s*\(|\.rpc\s*\(/);
  assert.doesNotMatch(source, /createClient|process\.env|service_role/i);
  assert.match(source, /NOT mounted as a route/);
  assert.match(source, /MUST originate from server-verified Supabase Auth/);
});

test('the existing Bible story index uses only vetted owner navigation fields', () => {
  const p = preview();
  p.facts.push({
    kind: 'foreshadowing',
    key: '秘密の鍵',
    confirmed: [],
    suggestions: [{
      sourceEpisodeId: 900,
      payload: { summary: '後で明らかになる', evidence: '鍵を拾った' }
    }]
  });
  const ready = check(fixture({ preview: p }));
  assert.ok(ready);
  const story = globalThis.NovelightAiBibleAuthorWorkspace.storyIndex(p);
  const view = globalThis.NovelightAiBibleOwnerOutline.project({
    expectedNovelId: ready.novelId,
    preview: p,
    outlineRows: ready.outlineRows,
    story
  });
  assert.equal(view.foreshadowing[0].references[0].episodeNumber, 2);
  assert.equal(view.foreshadowing[0].references[0].chapterTitle, '序章');
  assert.equal(Object.hasOwn(ready.outlineRows[1], 'episode_title'), false);
  assert.equal(Object.hasOwn(view.foreshadowing[0].references[0], 'episode_status'), false);
  assert.equal(Object.hasOwn(view.foreshadowing[0], 'storyTime'), false);

  p.facts[0].suggestions[0].sourceEpisodeId = 9999;
  const staleStory = globalThis.NovelightAiBibleAuthorWorkspace.storyIndex(p);
  assert.equal(globalThis.NovelightAiBibleOwnerOutline.project({
    expectedNovelId: ready.novelId,
    preview: p,
    outlineRows: ready.outlineRows,
    story: staleStory
  }), null);
});
