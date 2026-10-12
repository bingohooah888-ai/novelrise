import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';

const sql = readFileSync(
  new URL('../supabase/migrations/20261012133000_november_contest_catalog_zoning.sql', import.meta.url),
  'utf8'
);
const js = readFileSync(
  new URL('../novelight-contest-page.js', import.meta.url),
  'utf8'
);
const template = readFileSync(
  new URL('../api/_lib/contest-template.js', import.meta.url),
  'utf8'
);

test('public catalog rejects all nongeneral-zone works at the source', () => {
  assert.match(sql, /security definer/);
  assert.match(sql, /set search_path = ''/);
  assert.match(sql, /n.content_rating in \('general','sensitive_15','mature'\)/);
  assert.match(sql, /n.ai_usage in \('human','ai_assisted'\)/);
  assert.match(sql, /p_include_r15/);
  assert.match(sql, /n.content_rating = 'general'/);
  assert.match(sql, /public_visible is not true/);
  assert.match(sql, /status not in \('registration','active','review','finalized'\)/);
  assert.match(sql, /limit p_limit offset p_offset/);
  assert.doesNotMatch(sql, /'guest_key_hash'/);
  assert.doesNotMatch(sql, /'reader_id'/);
  assert.doesNotMatch(sql, /'author_id'/);
});

test('old catalog endpoint also delegates to general-zone filter', () => {
  assert.match(
    sql,
    /create or replace function public.novelight_public_contest_catalog\(/
  );
  assert.match(
    sql,
    /select public.novelight_public_contest_catalog_filtered\(/
  );
  assert.match(
    sql,
    /grant execute on function public.novelight_public_contest_catalog_filtered/
  );
});

test('reader setting persists under existing discovery preference key', () => {
  assert.match(js, /novelight:hide-r15-discovery/);
  assert.match(js, /novelight_public_contest_catalog_filtered/);
  assert.match(js, /p_include_r15: !storedHideR15\(\)/);
  assert.match(template, /id="contestHideR15"/);
  assert.match(template, /R15作品を表示しない/);
  assert.match(js, /myRevision !== requestRevision/);
});

function element() {
  return {
    children: [],
    hidden: false,
    textContent: '',
    checked: false,
    disabled: false,
    append(...items) {
      this.children.push(...items);
    },
    replaceChildren(...items) {
      this.children = items;
    },
    addEventListener(event, callback) {
      this.listeners ??= {};
      this.listeners[event] = callback;
    },
    setAttribute() {}
  };
}

async function simulate(initialPreference) {
  const elements = new Map();
  const createNode = () => element();
  const doc = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, createNode());
      return elements.get(id);
    },
    createElement: createNode
  };
  const saved = new Map([['novelight:hide-r15-discovery', initialPreference]]);
  const args = [];
  const client = {
    rpc: async (name, options) => {
      args.push({ name, options });
      return {
        data: {
          ok: true,
          contest_status: 'registration',
          total_entries: 0,
          entries: []
        },
        error: null
      };
    },
    auth: {
      getSession: async () => ({ data: { session: null }, error: null })
    }
  };
  const win = {
    localStorage: {
      getItem(key) {
        return saved.get(key);
      },
      setItem(key, value) {
        saved.set(key, value);
      }
    },
    addEventListener() {}
  };
  const supabase = { createClient: () => client };
  const NovelightClient = { recordVisit: () => Promise.resolve() };
  new Function('window', 'document', 'supabase', 'NovelightClient', js)(
    win,
    doc,
    supabase,
    NovelightClient
  );
  await Promise.resolve();
  await Promise.resolve();
  return {
    args,
    control: elements.get('contestHideR15'),
    saved
  };
}

test('R15 hide preference filters before loading the first page', async () => {
  const hidden = await simulate('1');
  assert.equal(hidden.control.checked, true);
  assert.equal(hidden.args[0].name, 'novelight_public_contest_catalog_filtered');
  assert.equal(hidden.args[0].options.p_include_r15, false);
  const visible = await simulate('0');
  assert.equal(visible.control.checked, false);
  assert.equal(visible.args[0].options.p_include_r15, true);
});
