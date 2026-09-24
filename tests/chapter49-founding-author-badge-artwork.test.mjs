import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

function has(text, token) {
  assert.equal(text.includes(token), true, `missing token: ${token}`);
}

test(
  'Founding Author limited badge renders the official artwork in SCOUT RECORD',
  async () => {
    const [html, css, js, artwork] = await Promise.all([
      readFile('scout-record.html', 'utf8'),
      readFile('novelight-scout-record.css', 'utf8'),
      readFile('novelight-scout-record.js', 'utf8'),
      readFile('assets/founding-authors-badge-2026.png')
    ]);

    assert.ok(artwork.byteLength > 0);
    has(
      js,
      "limited_founding_author: 'assets/founding-authors-badge-2026.png'"
    );
    has(js, "row.badge_id !== 'limited_founding_author'");
    has(js, 'row?.metadata?.founding_number');
    has(js, "padStart(3, '0')");
    has(js, "icon.classList.add('badge-icon-artwork')");
    has(js, 'renderBadgeDialogArtwork(row)');
    has(css, '.badge-icon-artwork');
    has(css, '.badge-dialog-artwork');
    has(html, 'id="badgeDialogArtwork"');
    has(html, 'id="badgeDialogArtworkImage"');
  }
);
