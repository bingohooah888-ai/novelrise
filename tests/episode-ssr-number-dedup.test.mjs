import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';
import { runInNewContext } from 'node:vm';

import {
  renderEpisodeArticle,
  visibleEpisodeTitle
} from '../api/seo/episode-article.js';

const browserContext = { window: {} };
runInNewContext(
  readFileSync(
    new URL('../novelight-episode-title-display.js', import.meta.url),
    'utf8'
  ),
  browserContext
);
const client = browserContext.window.NovelightEpisodeTitleDisplay;

test('SEO titles match the client for real published and edge case names', () => {
  const cases = [
    ['第121話　アルセラからのお礼状', 121],
    ['第10話：紙なら漉けると思った', 10],
    ['第１２３話・家族は宝物', 123],
    ['第123話「家族は宝物」', 123],
    ['第123話', 123],
    ['第123話はまだ続く', 123],
    ['第124話 違う話', 123],
    ['プロローグ', 1],
    ['第20話　最終話', 20]
  ];
  for (const [title, number] of cases) {
    for (const show of [true, false]) {
      assert.equal(
        visibleEpisodeTitle(title, number, show),
        client.visibleTitle(title, number, show),
        title
      );
    }
  }
});

test('SSR emits the author title intact when automatic numbers are disabled', () => {
  const episode = {
    id: 3360,
    episode_number: 10,
    title: '第10話：紙なら漉けると思った',
    show_episode_number: true
  };
  const novel = {
    id: 542,
    title: '歴史作品',
    show_episode_numbers: false
  };
  const rendered = renderEpisodeArticle(episode, novel, '本文');
  assert.match(rendered, /<h1>第10話：紙なら漉けると思った<\/h1>/u);
  assert.doesNotMatch(rendered, /class="number"/u);
  assert.equal((rendered.match(/第10話/gu) || []).length, 1);

  novel.show_episode_numbers = true;
  episode.show_episode_number = false;
  const perEpisodeHidden = renderEpisodeArticle(episode, novel, '本文');
  assert.match(
    perEpisodeHidden,
    /<h1>第10話：紙なら漉けると思った<\/h1>/u
  );
  assert.doesNotMatch(perEpisodeHidden, /class="number"/u);
});

test('SSR emits a separate number and title without duplicate prefixes', () => {
  const episode = {
    id: 3417,
    episode_number: 121,
    title: '第121話　アルセラからのお礼状',
    show_episode_number: true
  };
  const novel = {
    id: 257,
    title: '強欲のダンジョンの作り方',
    show_episode_numbers: true
  };
  const html = renderEpisodeArticle(episode, novel, '作品本文');
  assert.match(html, /<div class="number">第121話<\/div>/u);
  assert.match(html, /<h1>アルセラからのお礼状<\/h1>/u);
  assert.equal((html.match(/第121話/gu) || []).length, 1);

  const onlyNumber = renderEpisodeArticle(
    { ...episode, title: '第121話' },
    novel,
    '本文'
  );
  assert.match(onlyNumber, /<h1>本文を読む<\/h1>/u);
  assert.equal((onlyNumber.match(/第121話/gu) || []).length, 1);
});

test('SEO article content is escaped and original author data is preserved', () => {
  const episode = {
    episode_number: 3,
    title: '第3話　<script>alert(1)</script>'
  };
  const novel = {
    id: '542',
    title: '<img src=x>',
    show_episode_numbers: true
  };
  const original = episode.title;
  const html = renderEpisodeArticle(episode, novel, '<b>本文</b>');
  assert.match(html, /<h1>&lt;script&gt;alert\(1\)&lt;\/script&gt;<\/h1>/u);
  assert.match(html, /&lt;img src=x&gt;/u);
  assert.match(html, /&lt;b&gt;本文&lt;\/b&gt;/u);
  assert.equal(episode.title, original);
});

test('SEO handler requires explicit visibility flags and safe pre-gate reads', () => {
  const source = readFileSync(
    new URL('../api/seo/episode.js', import.meta.url),
    'utf8'
  );
  assert.match(source, /title,show_episode_number/u);
  assert.match(source, /content_warnings,show_episode_numbers/u);
  assert.match(source, /if \(!sensitive\) \{/u);
  assert.match(source, /renderEpisodeArticle\(episode, novel, content\)/u);
  assert.doesNotMatch(source, /<h1>\$\{escapeHtml\(episode\.title\)\}<\/h1>/u);
});
