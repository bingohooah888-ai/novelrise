import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

import '../novelight-ai-bible-consent-panel.js';

const { attach } = globalThis.NovelightAiBibleConsentPanel;
const OWNER = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'offline-author-session-token';
const REVISION = 'novel-bible-2026-10-30-v1';

function element(tag) {
  let text = '';
  const el = {
    tag,
    children: [],
    listeners: {},
    removed: false,
    checked: false,
    disabled: false,
    attrs: {},
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    setAttribute(k, v) {
      this.attrs[k] = v;
    },
    addEventListener(event, cb) {
      this.listeners[event] = cb;
    },
    remove() {
      this.removed = true;
    }
  };
  Object.defineProperty(el, 'textContent', {
    get() {
      return text;
    },
    set(value) {
      text = String(value);
      this.children = [];
    }
  });
  return el;
}

function fixture({ actor = OWNER, allowed = true } = {}) {
  const host = element('main');
  const calls = [];
  const state = {
    actor,
    token: TOKEN,
    consent: 'none',
    listener: null,
    grantPost: 0,
    revokePost: 0
  };
  const client = {
    auth: {
      async getSession() {
        return {
          data: {
            session: {
              user: { id: state.actor },
              access_token: state.token
            }
          },
          error: null
        };
      },
      onAuthStateChange(callback) {
        state.listener = callback;
        return {
          data: {
            subscription: {
              unsubscribe() {
                state.listener = null;
              }
            }
          }
        };
      }
    }
  };
  function view() {
    return {
      novelId: 41,
      policyRevision: REVISION,
      aiEnabled: false,
      disclosures: [
        {
          processor: 'openai',
          label: 'OpenAI / 検証用の架空同意内容',
          purpose: '架空の作品カルテ抽出',
          dataSent: '<script>テスト用・実原稿ではない</script>',
          retention: '架空の保持条件',
          internationalTransfer: '架空の国外移転説明',
          status: state.consent,
          expiresAt: state.consent === 'active' ? '2026-11-29T10:00:00Z' : null
        }
      ]
    };
  }
  async function fetcher(url, options) {
    calls.push({ url, options });
    if (!allowed) return { ok: false };
    if (options.method === 'GET') {
      return {
        ok: true,
        async json() {
          return view();
        }
      };
    }
    assert.equal(options.method, 'POST');
    const body = JSON.parse(options.body);
    assert.equal(body.processor, 'openai');
    assert.equal(options.headers['X-Novelight-Ai-Consent'], '1');
    if (body.action === 'grant') {
      state.grantPost += 1;
      assert.deepEqual(body, {
        action: 'grant',
        processor: 'openai',
        policyRevision: REVISION,
        acceptedExternalProcessing: true
      });
      state.consent = 'active';
    } else {
      assert.equal(body.action, 'revoke');
      assert.deepEqual(body, { action: 'revoke', processor: 'openai' });
      state.revokePost += 1;
      state.consent = 'revoked';
    }
    return {
      ok: true,
      async json() {
        return {
          novelId: 41,
          processor: 'openai',
          status: body.action === 'grant' ? 'granted' : 'revoked',
          aiEnabled: false
        };
      }
    };
  }
  const doc = {
    getElementById(id) {
      assert.equal(id, 'main-content');
      return host;
    },
    createElement: element
  };
  return {
    host,
    client,
    doc,
    fetcher,
    state,
    calls,
    logout() {
      state.actor = 'other-user';
      state.listener?.('SIGNED_OUT', null);
    }
  };
}

function sectionParts(f) {
  const section = f.host.children.at(-1);
  const rows = section.children[2];
  const row = rows.children[0];
  const button = row.children.at(-1);
  const checkbox = row.children
    .find((item) => item.tag === 'label')
    ?.children.find((item) => item.tag === 'input');
  return { section, rows, row, button, checkbox };
}

test('owner panel stays unmounted without an approved owner session', async () => {
  const f = fixture({ actor: 'another-owner' });
  assert.equal(
    await attach({
      client: f.client,
      ownerId: OWNER,
      novelId: 41,
      doc: f.doc,
      fetcher: f.fetcher
    }),
    false
  );
  assert.equal(f.calls.length, 0);
  assert.equal(f.host.children.length, 0);
});

test('API denial keeps all consent disclosures and controls off the page', async () => {
  const f = fixture({ allowed: false });
  assert.equal(
    await attach({
      client: f.client,
      ownerId: OWNER,
      novelId: 41,
      doc: f.doc,
      fetcher: f.fetcher
    }),
    false
  );
  assert.equal(f.host.children.length, 0);
  assert.equal(f.calls.length, 1);
});

test('textContent only, grant requires check and fresh owner session', async () => {
  const f = fixture();
  assert.equal(
    await attach({
      client: f.client,
      ownerId: OWNER,
      novelId: 41,
      doc: f.doc,
      fetcher: f.fetcher
    }),
    true
  );
  const first = sectionParts(f);
  assert.equal(first.button.textContent, '同意する');
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].options.method, 'GET');
  assert.equal(f.calls[0].options.cache, 'no-store');
  assert.equal(first.row.children[2].textContent, '保存・削除：架空の保持条件');
  assert.equal(
    first.row.children[3].textContent,
    '国外での処理：架空の国外移転説明'
  );
  assert.equal(first.row.children[1].textContent.includes('<script>'), true);

  await first.button.listeners.click();
  assert.equal(f.state.grantPost, 0);
  first.checkbox.checked = true;
  await first.button.listeners.click();
  assert.equal(f.state.grantPost, 1);
  assert.equal(f.state.consent, 'active');
  assert.equal(f.calls.length, 3);
  assert.equal(f.calls[2].options.method, 'GET');
  const after = sectionParts(f);
  assert.equal(after.button.textContent, '同意を撤回');
  f.logout();
  assert.equal(first.section.removed, true);
  assert.equal(first.section.textContent, '');
});

test('revoke has no new consent checkbox and only one POST per click', async () => {
  const f = fixture();
  f.state.consent = 'active';
  assert.equal(
    await attach({
      client: f.client,
      ownerId: OWNER,
      novelId: 41,
      doc: f.doc,
      fetcher: f.fetcher
    }),
    true
  );
  const initial = sectionParts(f);
  assert.equal(initial.checkbox, undefined);
  assert.equal(initial.button.textContent, '同意を撤回');
  await initial.button.listeners.click();
  assert.equal(f.state.revokePost, 1);
  assert.equal(f.state.consent, 'revoked');
  const current = sectionParts(f);
  assert.equal(current.button.textContent, '同意する');
  assert.equal(current.checkbox.checked, false);
  assert.equal(f.calls.length, 3);
});

test('owner loses session before click: consent is never transmitted', async () => {
  const f = fixture();
  await attach({
    client: f.client,
    ownerId: OWNER,
    novelId: 41,
    doc: f.doc,
    fetcher: f.fetcher
  });
  const controls = sectionParts(f);
  controls.checkbox.checked = true;
  f.state.actor = 'other-user';
  await controls.button.listeners.click();
  assert.equal(f.state.grantPost, 0);
  assert.equal(f.calls.length, 1);
  assert.equal(controls.section.removed, true);
});

test('no public page currently imports the unfinished consent panel', async () => {
  for (const page of ['mypage.html', 'my-novels.html', 'author-notes.html']) {
    const html = await readFile(new URL('../' + page, import.meta.url), 'utf8');
    assert.doesNotMatch(html, /novelight-ai-bible-consent-panel\.js/u);
  }
});
