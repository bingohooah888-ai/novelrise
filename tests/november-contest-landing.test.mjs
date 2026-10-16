import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { runInNewContext } from 'node:vm';
import { setImmediate as nextTick } from 'node:timers/promises';
import { isContestVisible } from '../api/contest-page.js';

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

const sql = source(
  '../supabase/migrations/20261012132000_november_contest_public_catalog.sql'
);
const page = source('../api/_lib/contest-template.js');
const js = source('../novelight-contest-page.js');
const css = source('../novelight-contest.css');

test('contest awards and scoring milestones', () => {
  assert.match(page, /11月1日（日）〜30日（月）/);
  assert.match(page, /10月31日（土）23:59/);
  assert.match(page, /10話以上/);
  assert.match(page, /1万円/);
  assert.match(page, /3話以上/);
  assert.match(page, /5話以上/);
  assert.match(page, /10話以上/);
  assert.match(page, /11月7日/);
  assert.match(page, /11月15日/);
  assert.match(page, /11月22日/);
  assert.match(page, /正午12:00/);
  assert.match(page, /同順位/);
});

test('contest public copy matches the owner-approved stage 05 rules', () => {
  assert.match(page, /1pt以上の上位5作品/);
  assert.match(page, /対象作品が5作品未満なら受賞数も減ります/);
  assert.match(page, /5位境界の同点作品/);
  assert.match(page, /公開済み10話以上の全年齢・R15作品/);
  assert.match(page, /R18・AI生成主体の作品は対象外/);
  assert.match(page, /コンテスト終了まで公開10話以上を維持/);
  assert.match(page, /12月1日/);
  assert.match(page, /NOVELIGHT登録メール/);
  assert.match(page, /受賞者は通知から1か月以内に返信/);
  assert.match(page, /返信受信から1か月以内に楽天銀行/);
  assert.match(page, /手数料は運営が負担/);
  assert.match(page, /公式応募要項への明示同意/);
  assert.doesNotMatch(page, /最終結果は審査後に発表/);
  assert.doesNotMatch(page, /詳しいコンテスト規約は受付開始時に/);
});

test('author enrollment uses a shared RPC widget', () => {
  assert.match(page, /src="novelight-contest-entry\.js"/);
  assert.match(page, /src="novelight-contest-page\.js"/);
  assert.match(js, /NovelightContestEntry\.mountContestPage/);
  assert.match(js, /auth\.getSession/);
  assert.match(js, /novelight_public_contest_catalog/);
  assert.doesNotMatch(js, /\.from\('novelight_contest_entries'\)/);
  assert.doesNotMatch(js, /\.from\('novelight_contest_readers'\)/);
});

test('public catalog is read-only and sanitizes work fields', () => {
  assert.match(sql, /security definer/);
  assert.match(sql, /set search_path = ''/);
  assert.match(sql, /limit v_limit offset p_offset/);
  assert.match(sql, /p_limit not between 1 and 48/);
  assert.match(sql, /e\.status = 'entered'/);
  assert.match(sql, /n\.status = 'published'/);
  assert.match(sql, /ep\.status = 'published'/);
  assert.match(sql, /episodes\.published_count >=/);
  assert.match(sql, /v_contest\.status in/);
  assert.match(sql, /'registration','active','review','finalized'/);
  assert.match(sql, /to anon, authenticated;/);
  assert.doesNotMatch(sql, /\bupdate\s+public\./i);
  assert.doesNotMatch(sql, /\bdelete\s+from\s+public\./i);
});

test('public cards contain no reader identifiers or banking details', () => {
  assert.doesNotMatch(sql, /'guest_key_hash'/);
  assert.doesNotMatch(sql, /'author_id'/);
  assert.doesNotMatch(sql, /'reader_id'/);
  assert.doesNotMatch(sql, /'transfer_reference'/);
  assert.doesNotMatch(sql, /'bank_account'/);
  assert.match(js, /title\.textContent/);
  assert.match(js, /chip\.textContent/);
  assert.match(js, /encodeURIComponent\(work\.novel_id\)/);
  assert.doesNotMatch(js, /innerHTML/);
});

test('entry page supports guest browsing, login and small screens', () => {
  assert.match(page, /id="contestEntries"/);
  assert.match(page, /id="contestEnrollment"/);
  assert.match(page, /id="contestLoginPrompt"/);
  assert.match(page, /id="contestMoreButton"/);
  assert.match(js, /async function loadEntries/);
  assert.match(js, /async function loadAuthorEnrollment/);
  assert.match(css, /max-width:820px/);
  assert.match(css, /max-width:560px/);
  assert.match(css, /prefers-reduced-motion/);
});

test('contest URL requires server publication approval', () => {
  assert.equal(existsSync(new URL('../contest.html', import.meta.url)), false);
  const vercel = JSON.parse(source('../vercel.json'));
  for (const route of ['/contest.html', '/contest']) {
    assert.ok(
      vercel.rewrites.some(
        (item) =>
          item.source === route && item.destination === '/api/contest-page'
      )
    );
  }
  const serverPage = source('../api/contest-page.js');
  assert.match(serverPage, /public_visible/);
  assert.match(serverPage, /notFound\(res\)/);
  assert.match(serverPage, /status\(404\)/);
  assert.match(sql, /v_contest\.public_visible is not true/);
});

test('server page denies unpublished or invalid states', () => {
  assert.equal(isContestVisible(null), false);
  assert.equal(
    isContestVisible({ status: 'draft', public_visible: false }),
    false
  );
  assert.equal(
    isContestVisible({ status: 'registration', public_visible: false }),
    false
  );
  assert.equal(
    isContestVisible({ status: 'registration', public_visible: true }),
    true
  );
  assert.equal(
    isContestVisible({ status: 'active', public_visible: true }),
    true
  );
  assert.equal(
    isContestVisible({ status: 'cancelled', public_visible: true }),
    false
  );
});


function makeContestGalleryBrowser(status, total = 8) {
  const workList = Array.from({ length: total }, (_, i) => ({
    novel_id: i + 100,
    title: '応募作品' + (i + 1),
    genre: 'ファンタジー',
    published_episodes: 10,
    content_rating: 'general'
  }));
  function node(tag = 'div') {
    return {
      tagName: tag.toUpperCase(),
      children: [],
      listeners: {},
      textContent: '',
      hidden: false,
      disabled: false,
      append(...items) { this.children.push(...items); },
      replaceChildren(...items) { this.children = items; },
      addEventListener(name, handler) { this.listeners[name] = handler; },
      setAttribute(name, value) { this[name] = value; }
    };
  }
  const ids = new Map();
  const doc = {
    getElementById(id) {
      if (!ids.has(id)) ids.set(id, node());
      return ids.get(id);
    },
    createElement: node
  };
  const requests = [];
  const client = {
    auth: {
      async getSession() { return { data: { session: null }, error: null }; }
    },
    async rpc(name, params) {
      requests.push({ name, params });
      if (name === 'novelight_public_contest_rankings') {
        return { data: { ok: false }, error: null };
      }
      assert.equal(name, 'novelight_public_contest_catalog_filtered');
      return {
        data: {
          ok: true,
          contest_status: status,
          total_entries: workList.length,
          entries: workList.slice(params.p_offset, params.p_offset + params.p_limit)
        },
        error: null
      };
    }
  };
  runInNewContext(js, {
    document: doc,
    supabase: { createClient: () => client },
    NovelightClient: { recordVisit: () => Promise.resolve() },
    window: {
      localStorage: { getItem: () => null },
      addEventListener() {}
    },
    console
  });
  return { ids, requests };
}

test('during registration only entered work cards display, with no reading links', async () => {
  const gallery = makeContestGalleryBrowser('registration');
  await nextTick();
  const cards = gallery.ids.get('contestEntries').children;
  assert.equal(cards.length, 6);
  assert.equal(gallery.ids.get('contestBrowseLink').textContent, '参加作品を見る');
  assert.equal(gallery.ids.get('entriesTitle').textContent, 'エントリー作品一覧');
  assert.match(gallery.ids.get('contestEntriesIntro').textContent, /11月1日の開幕後/);
  for (const card of cards) {
    assert.equal(card.children.some((part) => part.tagName === 'A'), false);
    assert.match(card.children.at(-1).textContent, /11月1日の開幕後に読めます/);
  }
  assert.equal(gallery.ids.get('contestMoreButton').hidden, false);
  assert.equal(gallery.requests[0].params.p_limit, 6);
  assert.equal(gallery.requests[0].params.p_offset, 0);

  await gallery.ids.get('contestMoreButton').listeners.click();
  assert.equal(gallery.ids.get('contestEntries').children.length, 8);
  assert.equal(gallery.requests[1].params.p_offset, 6);
  assert.equal(gallery.ids.get('contestMoreButton').hidden, true);
});

test('after contest opens the same entered works have reading links', async () => {
  const gallery = makeContestGalleryBrowser('active', 2);
  await nextTick();
  assert.equal(gallery.ids.get('contestBrowseLink').textContent, '参加作品を読む');
  assert.equal(gallery.ids.get('entriesTitle').textContent, '参加作品を読む');
  const cards = gallery.ids.get('contestEntries').children;
  assert.equal(cards.length, 2);
  for (const card of cards) {
    const link = card.children.find((part) => part.tagName === 'A');
    assert.match(link.href, /^novel\.html\?id=\d+$/);
    assert.equal(link.textContent, '作品を読む →');
  }
  assert.equal(gallery.ids.get('contestMoreButton').hidden, true);
});

test('pre-opening and unexpected states never expose contest reading links', async () => {
  for (const state of ['draft', 'registration', 'cancelled', 'unexpected']) {
    const gallery = makeContestGalleryBrowser(state, 1);
    await nextTick();
    assert.equal(
      gallery.ids.get('contestEntries').children[0].children.some((part) => part.tagName === 'A'),
      false
    );
  }
});
