import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  specialProjects,
  safeSpecialLink,
  publishedSpecialProjects,
  findPublishedSpecial
} from '../novelight-special-data.js';

const read = (path) =>
  readFileSync(join(import.meta.dirname, '..', path), 'utf8');
const example = Object.freeze({
  slug: 'writer-feature',
  status: 'published',
  title: '掲載許諾を得た企画',
  summary: '紹介文',
  body: ['企画紹介だけを掲載'],
  links: [{ label: '作品を読む', href: 'novel.html?id=42' }]
});

test('SPECIAL initial state never publishes fictional authors or unapproved projects', () => {
  assert.deepEqual(specialProjects, []);
  assert.deepEqual(publishedSpecialProjects(specialProjects), []);
});

test('only specifically published projects appear; drafts and malformed entries remain hidden', () => {
  const projects = [
    { ...example, status: 'draft', slug: 'not-yet' },
    { ...example },
    { ...example, slug: 'writer-feature', title: '重複' },
    { ...example, slug: '../unsafe' },
    { ...example, slug: 'broken', summary: '' }
  ];
  assert.deepEqual(publishedSpecialProjects(projects), [projects[1]]);
  assert.equal(findPublishedSpecial('not-yet', projects), null);
  assert.equal(findPublishedSpecial('writer-feature', projects), projects[1]);
  assert.equal(findPublishedSpecial('../unsafe', projects), null);
});

test('all rendered links reject executable schemes and preserve native reader gating', () => {
  assert.equal(safeSpecialLink('novel.html?id=123'), 'novel.html?id=123');
  assert.equal(safeSpecialLink('episode.html?id=456'), 'episode.html?id=456');
  assert.equal(safeSpecialLink('novel.html?id=wat'), null);
  assert.equal(safeSpecialLink('novel.html?id=1&admin=1'), null);
  assert.equal(safeSpecialLink('javascript:alert(1)'), null);
  assert.equal(safeSpecialLink('data:text/html,<script>'), null);
  assert.equal(safeSpecialLink('//malicious.example/novel.html'), null);
  assert.equal(safeSpecialLink('http://example.com'), null);
  assert.equal(
    safeSpecialLink('https://example.com/official'),
    'https://example.com/official'
  );
});

test('SPECIAL pages are static: no ADMIN or Supabase API and basic keyboard navigation exists', () => {
  const pages = [read('special.html'), read('special-detail.html')];
  for (const html of pages) {
    assert.match(html, /novelight-accessibility\.css/);
    assert.match(
      html,
      /<a class="skip-link" href="#main-content">本文へスキップ<\/a>/
    );
    assert.match(html, /<main id="main-content" tabindex="-1"/);
    assert.match(html, /src="novelight-special\.js"/);
    assert.doesNotMatch(html, /\/api\/|supabase|admin-special/i);
  }
  const renderer = read('novelight-special.js');
  assert.match(renderer, /textContent/);
  assert.doesNotMatch(
    renderer,
    /innerHTML|insertAdjacentHTML|createClient|fetch\(/
  );
  assert.match(read('index.html'), /href="special\.html"/);
});

test('no dedicated SPECIAL database, migration, or ADMIN page is introduced', () => {
  const dataset = read('novelight-special-data.js');
  assert.match(dataset, /specialProjects = Object\.freeze\(\[\]\)/);
  assert.doesNotMatch(dataset, /supabase\.from|createClient|service_role/);
});
