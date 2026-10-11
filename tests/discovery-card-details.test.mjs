import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';
import { runInNewContext } from 'node:vm';

const script = readFileSync(
  new URL('../novelight-discovery-list.js', import.meta.url),
  'utf8'
);
const css = readFileSync(
  new URL('../novelight-discovery-list.css', import.meta.url),
  'utf8'
);
const migration = readFileSync(
  new URL(
    '../supabase/migrations/20261011160000_public_discovery_card_state.sql',
    import.meta.url
  ),
  'utf8'
);

async function renderDiscovery(mode, stateAvailable = true) {
  const row = {
    novel_id: '554',
    title: '<タイトル>',
    genre: '現代ドラマ',
    status: 'published',
    light_seed_count: 2,
    total_count: 1,
    allocation_receipt: null,
    created_at: '2026-09-28T00:00:00.000Z'
  };
  const states = {
    novel_id: '554',
    author_name: '正式な作家名',
    is_completed: true,
    published_episode_count: 13,
    latest_published_at: '2026-10-10T12:00:00.000Z'
  };
  const calls = [];
  const elements = new Map();
  for (const id of [
    'discoveryList',
    'discoveryCount',
    'discoveryMoreWrap',
    'discoveryMore'
  ]) {
    elements.set(id, {
      innerHTML: '',
      textContent: '',
      hidden: false,
      disabled: false,
      addEventListener() {},
      insertAdjacentHTML(_position, html) {
        this.innerHTML += html;
      }
    });
  }
  const client = {
    auth: {
      async getSession() {
        return { data: { session: null } };
      }
    },
    async rpc(name) {
      calls.push(name);
      if (name === 'novelight_trusted_discovery_feed_v2') {
        return { data: [row], error: null };
      }
      if (name === 'novelight_neutral_search') {
        return { data: [row], error: null };
      }
      if (name === 'novelight_light_seed_feed') {
        return { data: [row], error: null };
      }
      if (name === 'novelight_public_discovery_card_state') {
        return stateAvailable
          ? { data: [states], error: null }
          : { data: null, error: { code: 'PGRST202' } };
      }
      if (name === 'novelight_search_card_metadata') {
        return {
          data: [
            {
              ...states,
              latest_published_at: undefined
            }
          ],
          error: null
        };
      }
      return { data: [], error: null };
    }
  };
  const doc = {
    body: { dataset: { discoveryMode: mode } },
    getElementById(id) {
      return elements.get(id);
    },
    createElement() {
      let value = '';
      return {
        set textContent(text) {
          value = String(text);
        },
        get innerHTML() {
          return value
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;');
        }
      };
    }
  };
  runInNewContext(script, {
    document: doc,
    window: { location: { origin: 'https://novelight.jp' } },
    supabase: { createClient: () => client },
    NovelightClient: {
      getVisitorToken: () => 'visitor-12345678',
      captureAcquisition: async () => {},
      recordVisit: async () => {},
      claimAcquisition: async () => {}
    },
    URL,
    console
  });
  for (let i = 0; i < 20; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
    if (
      elements.get('discoveryList').innerHTML.includes('discovery-card-meta')
    ) {
      break;
    }
  }
  return {
    html: elements.get('discoveryList').innerHTML,
    calls
  };
}

for (const mode of ['recommended', 'new', 'seed']) {
  test(`${mode} displays author and current publication details`, async () => {
    const { html, calls } = await renderDiscovery(mode);
    assert.match(html, /作者：正式な作家名/u);
    assert.match(html, /完結済み ・ 公開13話/u);
    assert.match(html, /最終投稿日：2026\/10\/10/u);
    assert.match(html, /&lt;タイトル&gt;/u);
    assert.doesNotMatch(html, /作者：未設定/u);
    assert.ok(calls.includes('novelight_public_discovery_card_state'));
  });
}

test('legacy lookup retains author and episode count', async () => {
  const { html, calls } = await renderDiscovery('recommended', false);
  assert.match(html, /作者：正式な作家名/u);
  assert.match(html, /完結済み ・ 公開13話/u);
  assert.match(html, /最終投稿日：確認できません/u);
  assert.ok(calls.includes('novelight_search_card_metadata'));
});

test('discovery CSS wraps authors and dates', () => {
  assert.match(css, /\.discovery-card-meta/u);
  assert.match(css, /overflow-wrap: anywhere/u);
  assert.match(css, /white-space: normal/u);
  assert.match(css, /\.discovery-card-author/u);
  assert.match(css, /\.discovery-card-updated/u);
});

test('public RPC cannot disclose draft works or future episodes', () => {
  assert.match(migration, /limit 100/u);
  assert.match(migration, /n\.status = 'published'/u);
  assert.match(migration, /novelight_is_general_discovery_eligible/u);
  assert.match(migration, /e\.status = 'published'/u);
  assert.match(migration, /e\.scheduled_publish_at <= now\(\)/u);
  assert.match(migration, /coalesce\(e\.first_published_at, e\.created_at\)/u);
  assert.match(migration, /revoke all on function/u);
  assert.match(migration, /to anon, authenticated/u);
});
