import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('all application pages with main content expose the shared accessibility baseline', () => {
  const pages = fs
    .readdirSync(root)
    .filter((name) => name.endsWith('.html'))
    .filter((name) => /<main\b/i.test(read(name)));

  assert.equal(pages.length, 58);
  for (const page of pages) {
    const html = read(page);
    assert.match(html, /novelight-accessibility\.css/, page);
    assert.match(
      html,
      /<a class="skip-link" href="#main-content">本文へスキップ<\/a>/,
      page
    );
    assert.match(
      html,
      /<main id="main-content" tabindex="-1"(?:\s[^>]*)?>/,
      page
    );
    assert.doesNotMatch(html, /tabindex="[1-9][0-9]*"/, page);
  }
});

test('shared accessibility CSS provides visible focus and reduced-motion behavior', () => {
  const css = read('novelight-accessibility.css');
  assert.match(css, /\.skip-link/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /outline:\s*3px solid/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /transition-duration:\s*0\.01ms/);
});

test('work owner view keeps beta-core actions visible and advanced tools collapsed', () => {
  const html = read('novel.html');
  const owner = html.match(
    /<div id="ownerActions"[\s\S]*?<div id="readerReportAction"/
  );
  assert.ok(owner, 'owner action block must exist');
  assert.match(owner[0], /class="owner-core"[\s\S]*?id="editNovel"/);
  assert.match(owner[0], /class="owner-core"[\s\S]*?id="newEpisode"/);
  assert.match(owner[0], /<details class="owner-more">/);
  assert.match(owner[0], /<summary>その他の作者ツール<\/summary>/);
  assert.match(owner[0], /id="managePolls"/);
  assert.match(owner[0], /id="manageStoryNotes"/);
  assert.match(owner[0], /id="manageCollaboration"/);
});

test('novel report dialog is keyboard-operable and announces status updates', () => {
  const html = read('novel.html');
  assert.match(html, /aria-describedby="reportDescription"/);
  assert.match(html, /<label for="reportCategory">通報理由<\/label>/);
  assert.match(html, /<label for="reportDetails">具体的な内容<\/label>/);
  assert.match(html, /role="status" aria-live="polite"/);
  assert.match(html, /event\.key==='Escape'/);
  assert.match(html, /event\.key!=='Tab'/);
  assert.match(html, /reportReturnFocus/);
  assert.match(html, /document\.getElementById\('reportCategory'\)\.focus\(\)/);
});
