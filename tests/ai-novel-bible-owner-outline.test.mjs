import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

import '../novelight-ai-bible-owner-outline.js';
import '../novelight-ai-bible-author-workspace.js';

const { project } = globalThis.NovelightAiBibleOwnerOutline;
const { storyIndex } = globalThis.NovelightAiBibleAuthorWorkspace;

const preview = () => ({
  novelId: 23,
  aiGenerated: false,
  characters: [],
  notes: [],
  facts: [
    {
      kind: 'foreshadowing',
      key: '鍵の秘密',
      confirmed: [],
      suggestions: [
        {
          sourceEpisodeId: 900,
          payload: { summary: 'いつか開かれる', evidence: '鍵は机にあった' }
        }
      ]
    },
    {
      kind: 'event',
      key: '旅立ち',
      confirmed: [
        {
          sourceEpisodeId: 100,
          payload: { summary: '旅に出る', evidence: '' }
        }
      ],
      suggestions: []
    },
    {
      kind: 'timeline',
      key: '回想',
      confirmed: [
        {
          sourceEpisodeId: 900,
          payload: { summary: '過去について語る', evidence: '' }
        }
      ],
      suggestions: []
    }
  ]
});

const rows = () => [
  {
    episode_id: 100,
    episode_number: 7,
    episode_title: '序章',
    episode_status: 'published',
    chapter_id: 400,
    chapter_title: '第一章',
    chapter_position: 2
  },
  {
    episode_id: '900',
    episode_number: '2',
    episode_title: '鍵',
    episode_status: 'draft',
    chapter_id: 300,
    chapter_title: 'プロローグ',
    chapter_position: 1
  }
];

function run({
  source = preview(),
  outline = rows(),
  expectedNovelId = 23
} = {}) {
  return project({
    expectedNovelId,
    preview: source,
    outlineRows: outline,
    story: storyIndex(source)
  });
}

test('author-only RPC outline maps episode IDs to true displayed episode numbers', () => {
  const original = preview();
  const originalRows = rows();
  const output = run({ source: original, outline: originalRows });
  assert.ok(output);
  assert.deepEqual(output.foreshadowing[0].references, [
    {
      episodeId: 900,
      episodeNumber: 2,
      chapterId: 300,
      chapterTitle: 'プロローグ',
      chapterPosition: 1
    }
  ]);
  assert.equal(output.events[0].key, '回想');
  assert.equal(output.events[0].references[0].episodeNumber, 2);
  assert.equal(output.events[1].key, '旅立ち');
  assert.equal(output.events[1].references[0].episodeNumber, 7);
  assert.equal(originalRows[1].episode_number, '2');
  assert.equal(original.facts[0].key, '鍵の秘密');
});

test('chapter numbers remain navigation ordinals, not an inferred fictional timeline', () => {
  const output = run();
  assert.equal(Object.hasOwn(output.events[0], 'storyTime'), false);
  assert.equal(Object.hasOwn(output.events[0], 'chronology'), false);
  assert.equal(output.events[0].firstEpisodeNumber, 2);
  assert.equal(output.events[1].firstEpisodeNumber, 7);
});

test('missing source episode IDs never receive inferred chapter positions', () => {
  const p = preview();
  p.facts[0].suggestions[0].sourceEpisodeId = undefined;
  const output = run({ source: p });
  assert.ok(output);
  assert.equal(output.foreshadowing[0].firstEpisodeNumber, null);
  assert.deepEqual(output.foreshadowing[0].references, []);
  const stale = preview();
  stale.facts[0].suggestions[0].sourceEpisodeId = 999;
  assert.equal(run({ source: stale }), null);
});

test('mixed works, incomplete owner preview and non-authorized shapes fail closed', () => {
  const source = preview();
  assert.equal(run({ source: { ...source, novelId: 24 } }), null);
  assert.equal(run({ source: { ...source, aiGenerated: true } }), null);
  assert.equal(run({ source: { ...source, aiGenerated: undefined } }), null);
  assert.equal(run({ expectedNovelId: '23' })?.events.length, 2);
  assert.equal(run({ expectedNovelId: '23e0' }), null);
  assert.equal(run({ outline: null }), null);
});

test('duplicate IDs, duplicate positions and conflicting chapters fail closed', () => {
  const originalRows = rows();
  for (const outline of [
    [{ ...originalRows[0] }, { ...originalRows[0] }],
    [{ ...originalRows[0] }, { ...originalRows[1], episode_number: 7 }],
    [{ ...originalRows[0], chapter_id: undefined }],
    [{ ...originalRows[0], chapter_title: null }],
    [{ ...originalRows[0], chapter_position: 0 }],
    [{ ...originalRows[0], episode_id: 'not-an-id' }],
    [
      {
        ...originalRows[0],
        chapter_id: null,
        chapter_title: 'bad',
        chapter_position: null
      }
    ],
    [
      { ...originalRows[0], chapter_id: 400, chapter_position: 2 },
      {
        ...originalRows[1],
        chapter_id: 400,
        chapter_title: '違う章',
        chapter_position: 2
      }
    ]
  ]) {
    assert.equal(run({ outline }), null);
  }
});

test('the deployed author preview cannot silently start using outline RPC', async () => {
  const moduleText = await readFile(
    new URL('../novelight-ai-bible-owner-outline.js', import.meta.url),
    'utf8'
  );
  const previewApi = await readFile(
    new URL('../api/_lib/ai/owner-novel-bible-preview.js', import.meta.url),
    'utf8'
  );
  const studioHtml = await readFile(
    new URL('../story-notes.html', import.meta.url),
    'utf8'
  );
  assert.doesNotMatch(moduleText, /fetch\s*\(|\.rpc\s*\(/);
  assert.doesNotMatch(previewApi, /novelight_novel_outline/);
  assert.doesNotMatch(studioHtml, /src="novelight-ai-bible-owner-outline.js"/);
  assert.doesNotMatch(previewApi, /episodeOutline|outlineRows/);
});

test('source SQL defines owner/private outline and exact column names', async () => {
  const sql = await readFile(
    new URL(
      '../supabase/migrations/20260918070000_chapter_episode_ordering.sql',
      import.meta.url
    ),
    'utf8'
  );
  const rpc = sql.slice(
    sql.indexOf('create function public.novelight_novel_outline(')
  );
  assert.match(rpc, /episode_id bigint/);
  assert.match(rpc, /episode_number bigint/);
  assert.match(rpc, /chapter_id bigint/);
  assert.match(rpc, /chapter_title text/);
  assert.match(rpc, /chapter_position bigint/);
  assert.match(
    rpc,
    /v_is_owner := v_user_id is not null and v_user_id = v_owner_id/
  );
  assert.match(
    rpc,
    /v_is_owner\s*or \(v_novel_status = 'published' and e.status = 'published'\)/
  );
});
