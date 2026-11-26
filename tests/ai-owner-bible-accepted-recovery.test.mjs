import assert from 'node:assert/strict';
import test from 'node:test';

import { createOwnerBibleReviewWorkflow } from '../api/_lib/ai/owner-bible-review-workflow.js';
import '../novelight-ai-bible-note-transfer.js';
import '../novelight-ai-bible-review-actions.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'synthetic-session-owner-only';
const HASH = 'a'.repeat(64);

function acceptedRow(extra = {}) {
  return {
    id: 77,
    actorId: OWNER,
    novelId: 354,
    sourceEpisodeId: 41,
    sourceHash: HASH,
    factKind: 'world',
    factKey: '青い王都',
    summary: '青い石造りの城壁を持つ。',
    evidence: '王都の城壁は青かった。',
    provenance: 'ai_inferred',
    status: 'accepted',
    revision: 2,
    ...extra
  };
}

function authorWorkflow({ accepted = [acceptedRow()], pending = [] } = {}) {
  const state = { accepted, pending, loads: 0 };
  const authClient = {
    auth: {
      async getUser(value) {
        return {
          data: { user: { id: value === TOKEN ? OWNER : 'other-user' } },
          error: null
        };
      }
    }
  };
  const serviceClient = {
    from(name) {
      assert.equal(name, 'novels');
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        async maybeSingle() {
          state.loads += 1;
          return { data: { id: 354, user_id: OWNER }, error: null };
        }
      };
    }
  };
  const repository = {
    async listAuthorConfirmed() {
      return [];
    },
    async savePendingBatch() {
      return { count: 0 };
    },
    async readCandidate() {
      return null;
    },
    async compareAndSwapDecision() {
      return null;
    },
    async listPending({ actorId, novelId }) {
      assert.equal(actorId, OWNER);
      assert.equal(novelId, 354);
      return state.pending;
    },
    async listAccepted({ actorId, novelId }) {
      assert.equal(actorId, OWNER);
      assert.equal(novelId, 354);
      return state.accepted;
    }
  };
  return {
    state,
    workflow: createOwnerBibleReviewWorkflow({
      enabled: true,
      ownerId: OWNER,
      authClient,
      serviceClient,
      repository
    })
  };
}

function element(tag) {
  return {
    tag,
    textContent: '',
    children: [],
    removed: false,
    listeners: {},
    appendChild(child) {
      this.children.push(child);
    },
    addEventListener(event, cb) {
      this.listeners[event] = cb;
    },
    remove() {
      this.removed = true;
    }
  };
}

function editor() {
  const fields = Object.fromEntries(
    [
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
    ].map((key) => [key, { value: '', textContent: '', hidden: false }])
  );
  fields.noteType.value = 'plot';
  fields.cancel.hidden = true;
  return {
    fields,
    document: {
      getElementById(name) {
        return fields[name] ?? null;
      }
    }
  };
}

test('accepted reviews are retrieved by owner alongside the pending contract', async () => {
  const { workflow } = authorWorkflow();
  const result = await workflow.list({ token: TOKEN, novelId: 354 });
  assert.deepEqual(result, {
    novelId: 354,
    candidates: [],
    acceptedCandidates: [
      {
        id: 77,
        revision: 2,
        episodeId: 41,
        kind: 'world',
        key: '青い王都',
        summary: '青い石造りの城壁を持つ。',
        evidence: '王都の城壁は青かった。',
        status: 'accepted'
      }
    ],
    aiGenerated: false
  });
});

test('reviewed candidate is recoverable after page reload for manual note save', async () => {
  const { workflow } = authorWorkflow();
  const notes = editor();
  const host = element('main');
  let callback;
  let reads = 0;
  const client = {
    auth: {
      async getSession() {
        return {
          data: {
            session: { user: { id: OWNER }, access_token: TOKEN }
          },
          error: null
        };
      },
      onAuthStateChange(fn) {
        callback = fn;
        return { data: { subscription: { unsubscribe() {} } } };
      }
    }
  };
  const mounted = await globalThis.NovelightAiBibleReviewActions.attach({
    client,
    ownerId: OWNER,
    novelId: 354,
    doc: {
      getElementById(name) {
        return name === 'main-content' ? host : null;
      },
      createElement: element
    },
    fetcher: async (_url, options) => {
      assert.equal(options.method, 'GET');
      reads += 1;
      return {
        ok: true,
        json: () => workflow.list({ token: TOKEN, novelId: 354 })
      };
    },
    onAccepted: async (candidate) =>
      globalThis.NovelightAiBibleNoteTransfer.prepare({
        candidate,
        doc: notes.document
      })
  });
  assert.equal(mounted, true);
  assert.equal(reads, 1);
  assert.equal(notes.fields.body.value, '');
  const section = host.children[0];
  const list = section.children[1];
  assert.match(list.textContent, /保留中の候補はありません/);
  assert.match(list.children[0].textContent, /確認済み候補/);
  assert.match(list.children[1].children[0].textContent, /青い王都/);
  const transferButton = list.children[1].children[1].children[0];
  assert.match(transferButton.textContent, /転記して編集/);
  await transferButton.listeners.click();
  assert.equal(notes.fields.noteType.value, 'world');
  assert.equal(notes.fields.title.value, '青い王都');
  assert.match(notes.fields.body.value, /王都の城壁は青かった/);
  assert.equal(notes.fields.noteId.value, '');
  assert.equal(reads, 1);
  callback('SIGNED_OUT', null);
  assert.equal(section.removed, true);
});

test('foreign, malformed, duplicate or not-accepted rows fail closed', async () => {
  const invalid = [
    [acceptedRow({ actorId: 'other' })],
    [acceptedRow({ novelId: 99 })],
    [acceptedRow({ status: 'pending' })],
    [acceptedRow({ revision: 1 })],
    [acceptedRow({ sourceHash: 'corrupted' })],
    [acceptedRow(), acceptedRow()]
  ];
  for (const accepted of invalid) {
    const { workflow } = authorWorkflow({ accepted });
    await assert.rejects(
      workflow.list({ token: TOKEN, novelId: 354 }),
      /AI_OWNER_REVIEW_DENIED/
    );
  }
  const { workflow } = authorWorkflow();
  await assert.rejects(
    workflow.list({ token: 'not-owner', novelId: 354 }),
    /AI_OWNER_REVIEW_DENIED/
  );
});

test('pending and accepted candidate IDs cannot overlap', async () => {
  const item = acceptedRow();
  const { workflow } = authorWorkflow({
    accepted: [item],
    pending: [{ ...item, status: 'pending', revision: 1 }]
  });
  await assert.rejects(
    workflow.list({ token: TOKEN, novelId: 354 }),
    /AI_OWNER_REVIEW_DENIED/
  );
});
