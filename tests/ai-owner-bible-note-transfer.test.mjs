import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

import '../novelight-ai-bible-note-transfer.js';
import '../novelight-ai-bible-review-actions.js';

const { buildDraft, prepare } = globalThis.NovelightAiBibleNoteTransfer;
const { attach } = globalThis.NovelightAiBibleReviewActions;
const OWNER = '11111111-1111-4111-8111-111111111111';
const CANDIDATE = {
  kind: 'character',
  key: '凛',
  summary: '青い鍵を持つ人物。',
  evidence: '凛は青い鍵を持っていた。',
  episodeId: 42
};

function editor() {
  const ids = [
    'noteForm',
    'noteId',
    'noteType',
    'character',
    'characterField',
    'title',
    'body',
    'formTitle',
    'save',
    'cancel',
    'titleCount',
    'bodyCount'
  ];
  const items = Object.fromEntries(
    ids.map((id) => [
      id,
      { value: '', textContent: '', hidden: id === 'characterField' }
    ])
  );
  items.noteType.value = 'plot';
  items.cancel.hidden = true;
  const doc = {
    getElementById(id) {
      return items[id] ?? null;
    }
  };
  return { items, doc };
}

function element(tag) {
  return {
    tag,
    textContent: '',
    children: [],
    listeners: {},
    removed: false,
    appendChild(child) {
      this.children.push(child);
    },
    addEventListener(event, handler) {
      this.listeners[event] = handler;
    },
    remove() {
      this.removed = true;
    }
  };
}

function review({ onAccepted, initialActor = OWNER } = {}) {
  const host = element('main');
  let actor = initialActor;
  let listener;
  const requests = [];
  const client = {
    auth: {
      async getSession() {
        return {
          data: {
            session: { user: { id: actor }, access_token: 'offline-token' }
          },
          error: null
        };
      },
      onAuthStateChange(fn) {
        listener = fn;
        return { data: { subscription: { unsubscribe() {} } } };
      }
    }
  };
  const fetcher = async (url, options) => {
    requests.push({ url, method: options.method });
    if (options.method === 'POST') {
      return {
        ok: true,
        async json() {
          return {
            novelId: 354,
            candidateId: 7,
            status: 'accepted',
            revision: 2,
            canonModified: false
          };
        }
      };
    }
    return {
      ok: true,
      async json() {
        return {
          novelId: 354,
          aiGenerated: false,
          candidates: [
            {
              ...CANDIDATE,
              id: 7,
              revision: 1,
              status: 'pending'
            }
          ]
        };
      }
    };
  };
  const doc = {
    getElementById(id) {
      return id === 'main-content' ? host : null;
    },
    createElement: element
  };
  return {
    host,
    requests,
    signOut() {
      actor = 'other';
      listener?.('SIGNED_OUT', {
        user: { id: 'other' },
        access_token: 'other-token'
      });
    },
    attach() {
      return attach({
        client,
        ownerId: OWNER,
        novelId: 354,
        doc,
        fetcher,
        onAccepted
      });
    }
  };
}

test('all existing AI categories map to the same Story Notes types', () => {
  const expected = {
    character: 'character',
    world: 'world',
    location: 'world',
    relationship: 'plot',
    timeline: 'plot',
    event: 'plot',
    foreshadowing: 'plot',
    other: 'plot'
  };
  for (const [kind, type] of Object.entries(expected)) {
    const draft = buildDraft({ ...CANDIDATE, kind });
    assert.equal(draft.noteType, type);
    assert.equal(draft.title, '凛');
    assert.match(draft.body, /本文根拠：凛は青い鍵を持っていた/);
    assert.match(draft.body, /参照エピソードID：42/);
    assert.ok(Object.isFrozen(draft));
  }
});

test('candidate is transferred only into the unsaved editor, and author selects character', () => {
  const e = editor();
  assert.equal(prepare({ candidate: CANDIDATE, doc: e.doc }), true);
  assert.equal(e.items.noteType.value, 'character');
  assert.equal(e.items.character.value, '');
  assert.equal(e.items.characterField.hidden, false);
  assert.equal(e.items.noteId.value, '');
  assert.equal(e.items.title.value, '凛');
  assert.match(e.items.body.value, /青い鍵を持つ人物/);
  assert.match(e.items.formTitle.textContent, /未保存/);
  assert.match(e.items.save.textContent, /確認して保存/);
  assert.equal(e.items.cancel.hidden, false);
  assert.match(e.items.bodyCount.textContent, /20000/);
});

test('unsaved edits and existing note IDs are not overwritten without separate confirmation', () => {
  const e = editor();
  e.items.noteId.value = '123';
  e.items.title.value = '作者の編集中ノート';
  e.items.body.value = '絶対に消さない';
  assert.equal(prepare({ candidate: CANDIDATE, doc: e.doc }), false);
  assert.equal(
    prepare({ candidate: CANDIDATE, doc: e.doc, allowReplace: () => false }),
    false
  );
  assert.equal(e.items.noteId.value, '123');
  assert.equal(e.items.title.value, '作者の編集中ノート');
  assert.equal(e.items.body.value, '絶対に消さない');
  let confirmations = 0;
  assert.equal(
    prepare({
      candidate: CANDIDATE,
      doc: e.doc,
      allowReplace() {
        confirmations += 1;
        return true;
      }
    }),
    true
  );
  assert.equal(confirmations, 1);
  assert.equal(e.items.noteId.value, '');
  assert.equal(e.items.title.value, '凛');
});

test('bad inference text cannot alter the author editor', () => {
  for (const bad of [
    { ...CANDIDATE, kind: 'unknown' },
    { ...CANDIDATE, summary: '' },
    { ...CANDIDATE, evidence: '' },
    { ...CANDIDATE, key: 'a'.repeat(121) },
    { ...CANDIDATE, episodeId: 0 },
    { ...CANDIDATE, episodeId: '42' },
    null
  ]) {
    const e = editor();
    assert.equal(prepare({ candidate: bad, doc: e.doc }), false);
    assert.equal(e.items.title.value, '');
    assert.equal(e.items.body.value, '');
  }
});

test('review acceptance and note preparation each require a separate author click', async () => {
  const e = editor();
  let handoffs = 0;
  const r = review({
    onAccepted: async (candidate) => {
      handoffs += 1;
      return prepare({ candidate, doc: e.doc });
    }
  });
  assert.equal(await r.attach(), true);
  const section = r.host.children[0];
  const list = section.children[1];
  const initialRow = list.children[0];
  assert.equal(r.requests.length, 1);
  assert.equal(handoffs, 0);
  assert.equal(e.items.title.value, '');

  await initialRow.children[1].listeners.click();
  assert.deepEqual(
    r.requests.map((item) => item.method),
    ['GET', 'POST']
  );
  assert.equal(initialRow.removed, true);
  assert.equal(handoffs, 0);
  assert.equal(e.items.title.value, '');
  assert.equal(list.children.length, 2);
  const transfer = list.children[1];
  assert.match(transfer.children[0].textContent, /保存は別途/);
  await transfer.children[0].listeners.click();
  assert.equal(handoffs, 1);
  assert.equal(transfer.removed, true);
  assert.equal(e.items.title.value, '凛');
  assert.equal(r.requests.length, 2);
  assert.match(section.children[2].textContent, /「保存」を押してください/);
});

test('mock existing note RPC saves only after another author action and rereads data', async () => {
  const e = editor();
  assert.equal(prepare({ candidate: CANDIDATE, doc: e.doc }), true);
  let saveCalls = 0;
  const stored = [];
  const client = {
    async rpc(name, payload) {
      if (name === 'novelight_save_private_story_note') {
        saveCalls += 1;
        if (payload.p_note_type === 'character' && !payload.p_character_id) {
          return { error: { code: '22023' }, data: null };
        }
        const row = {
          id: stored.length + 1,
          note_type: payload.p_note_type,
          character_id: payload.p_character_id,
          title: payload.p_title,
          body: payload.p_body
        };
        stored.push(row);
        return { data: { id: row.id }, error: null };
      }
      assert.equal(name, 'novelight_private_story_notes');
      return { data: [...stored], error: null };
    }
  };
  assert.equal(saveCalls, 0);
  e.items.character.value = '77'; // Author explicitly selects registered ID.
  const result = await client.rpc('novelight_save_private_story_note', {
    p_novel_id: 354,
    p_note_id: null,
    p_note_type: e.items.noteType.value,
    p_character_id: Number(e.items.character.value),
    p_title: e.items.title.value,
    p_body: e.items.body.value
  });
  assert.equal(result.error, null);
  assert.equal(saveCalls, 1);
  const fresh = await client.rpc('novelight_private_story_notes', {
    p_novel_id: 354
  });
  assert.equal(fresh.data.length, 1);
  assert.equal(fresh.data[0].title, '凛');
  assert.equal(fresh.data[0].character_id, 77);
  assert.match(fresh.data[0].body, /本文根拠/);
});

test('review session change removes the transfer action before any draft handoff', async () => {
  const e = editor();
  let transferred = 0;
  const r = review({
    onAccepted() {
      transferred += 1;
      return prepare({ candidate: CANDIDATE, doc: e.doc });
    }
  });
  await r.attach();
  const section = r.host.children[0];
  const list = section.children[1];
  await list.children[0].children[1].listeners.click();
  r.signOut();
  assert.equal(section.removed, true);
  await list.children[1].children[0].listeners.click();
  assert.equal(transferred, 0);
  assert.equal(e.items.title.value, '');
});

test('owner author page uses existing save and reread without a new writer', () => {
  const page = readFileSync(
    new URL('../story-notes.html', import.meta.url),
    'utf8'
  );
  assert.match(page, /novelight-ai-bible-note-transfer\.js/);
  assert.match(page, /NovelightAiBibleReviewActions\.attach/);
  assert.match(page, /onAccepted:async candidate/);
  assert.match(page, /novelight_save_private_story_note/);
  assert.match(page, /await loadNotes\(\)/);
  assert.doesNotMatch(page, /ai_bible_canon_upsert|ai_bible_auto_accept/);
});
