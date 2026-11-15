import assert from 'node:assert/strict';
import test from 'node:test';

import '../novelight-ai-bible-trial-panel.js';

const { attach } = globalThis.NovelightAiBibleTrialPanel;
const OWNER = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'synthetic-author-token-only';
const work = 41;
const episode = 11;

function element(tag) {
  return {
    tag,
    className: '',
    textContent: '',
    hidden: false,
    disabled: false,
    children: [],
    listeners: new Map(),
    append(...nodes) {
      this.children.push(...nodes);
    },
    appendChild(child) {
      this.children.push(child);
    },
    addEventListener(event, callback) {
      this.listeners.set(event, callback);
    },
    setAttribute() {},
    remove() {
      this.removed = true;
    }
  };
}

function harness({ state = 'ready', nextIndex = 1, revoke = false } = {}) {
  let active = true;
  let signedIn = true;
  let inspected = 0;
  let staged = 0;
  let opened = 0;
  let lastIndex = null;
  let lastToken = null;
  let planStatus = state;
  const main = element('main');
  const doc = {
    getElementById(name) {
      assert.equal(name, 'main-content');
      return main;
    },
    createElement: element
  };
  let listener;
  const client = {
    auth: {
      async getSession() {
        return {
          data: {
            session: signedIn
              ? { user: { id: OWNER }, access_token: TOKEN }
              : null
          },
          error: null
        };
      },
      onAuthStateChange(callback) {
        listener = callback;
        return { data: { subscription: { unsubscribe() {} } } };
      }
    }
  };
  const fetchCalls = [];
  const fetcher = async (url, options) => {
    fetchCalls.push([url, options.method]);
    assert.equal(options.method, 'GET');
    return {
      ok: true,
      json: async () => ({
        trialReady: true,
        novelId: work,
        episodeId: episode,
        chunkIndex: 0
      })
    };
  };
  const offlineTrial = {
    enabled: true,
    async inspectPlan(args) {
      inspected += 1;
      lastToken = args.token;
      assert.equal(args.novelId, work);
      assert.equal(args.episodeId, episode);
      if (!active) throw new Error('SYNTHETIC_REVOKED');
      return {
        novelId: work,
        episodeId: episode,
        chunkCount: 3,
        nextChunkIndex: planStatus === 'completed' ? null : nextIndex,
        status: planStatus
      };
    },
    async stage(args) {
      staged += 1;
      lastIndex = args.chunkIndex;
      assert.equal(args.token, TOKEN);
      return {
        novelId: work,
        stagedCount: 1,
        requiresAuthorReview: true
      };
    }
  };
  const reviewPanel = {
    async attach() {
      opened += 1;
      return true;
    }
  };
  return {
    doc,
    main,
    client,
    fetcher,
    offlineTrial,
    reviewPanel,
    get inspected() {
      return inspected;
    },
    get staged() {
      return staged;
    },
    get opened() {
      return opened;
    },
    get lastIndex() {
      return lastIndex;
    },
    get lastToken() {
      return lastToken;
    },
    get fetchCalls() {
      return fetchCalls;
    },
    revoke() {
      active = false;
    },
    signOut() {
      signedIn = false;
      listener?.('SIGNED_OUT', null);
    },
    setPlan(next, nextState = 'ready') {
      nextIndex = next;
      planStatus = nextState;
    }
  };
}

function controls(main) {
  const section = main.children[0];
  assert.ok(section);
  const plan = section.children.find(
    (item) => item.className === 'btn novelight-ai-bible-inspect-plan'
  );
  const buttons = section.children.filter((item) => item.tag === 'button');
  return { section, plan, action: buttons[1], review: buttons[2] };
}

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

test(
  'offline owner must inspect before one explicit stage and then sees review',
  async () => {
  const f = harness();
  assert.equal(
    await attach({
      client: f.client,
      novelId: work,
      ownerId: OWNER,
      doc: f.doc,
      fetcher: f.fetcher,
      reviewPanel: f.reviewPanel,
      offlineTrial: f.offlineTrial
    }),
    true
  );
  const { section, plan, action } = controls(f.main);
  assert.equal(action.disabled, true);
  assert.equal(f.inspected, 0);
  assert.equal(f.staged, 0);
  await plan.listeners.get('click')();
  assert.equal(f.inspected, 1);
  assert.equal(action.disabled, false);
  assert.match(section.children.at(-1).textContent, /次の対象 2/u);
  await action.listeners.get('click')();
  assert.equal(f.inspected, 2);
  assert.equal(f.staged, 1);
  assert.equal(f.lastIndex, 1);
  assert.equal(f.opened, 1);
  assert.equal(f.lastToken, TOKEN);
  assert.equal(f.fetchCalls.length, 1);
  assert.match(section.children.at(-1).textContent, /1件/u);
  await action.listeners.get('click')();
  assert.equal(f.staged, 1);
});

test(
  'changed plan, completed work or revoked session cannot execute',
  async () => {
  const changed = harness();
  assert.equal(
    await attach({
      client: changed.client,
      novelId: work,
      ownerId: OWNER,
      doc: changed.doc,
      fetcher: changed.fetcher,
      reviewPanel: changed.reviewPanel,
      offlineTrial: changed.offlineTrial
    }),
    true
  );
  const controlsChanged = controls(changed.main);
  await controlsChanged.plan.listeners.get('click')();
  changed.setPlan(2);
  await controlsChanged.action.listeners.get('click')();
  assert.equal(changed.staged, 0);
  assert.match(
    controlsChanged.section.children.at(-1).textContent,
    /再読込/u
  );

  const completed = harness({ state: 'completed' });
  assert.equal(
    await attach({
      client: completed.client,
      novelId: work,
      ownerId: OWNER,
      doc: completed.doc,
      fetcher: completed.fetcher,
      reviewPanel: completed.reviewPanel,
      offlineTrial: completed.offlineTrial
    }),
    true
  );
  const completeControls = controls(completed.main);
  await completeControls.plan.listeners.get('click')();
  assert.equal(completeControls.action.disabled, true);
  assert.equal(completed.staged, 0);
  completed.signOut();
  assert.equal(completed.main.children[0].removed, true);
  assert.equal(completed.main.children[0].textContent, '');
  await tick();
});

test(
  'missing offline capability does not change default deployed panel',
  async () => {
  const invalid = harness();
  assert.equal(
    await attach({
      client: invalid.client,
      novelId: work,
      ownerId: OWNER,
      doc: invalid.doc,
      fetcher: invalid.fetcher,
      offlineTrial: { enabled: true, inspectPlan() {} }
    }),
    false
  );
  assert.equal(invalid.main.children.length, 0);
  const legacy = harness();
  assert.equal(
    await attach({
      client: legacy.client,
      novelId: work,
      ownerId: OWNER,
      doc: legacy.doc,
      fetcher: legacy.fetcher,
      reviewPanel: legacy.reviewPanel
    }),
    true
  );
  const section = legacy.main.children[0];
  assert.equal(
    section.children.some(
      (item) => item.className === 'btn novelight-ai-bible-inspect-plan'
    ),
    false
  );
  assert.equal(legacy.fetchCalls.length, 1);
});
