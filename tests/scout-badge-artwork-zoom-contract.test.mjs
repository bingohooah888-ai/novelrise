import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('SCOUT badge details load the second-stage artwork zoom assets', async () => {
  const html = await readFile('scout-record.html', 'utf8');

  assert.ok(html.includes('novelight-scout-badge-zoom.css'));
  assert.ok(html.includes('id="badgeArtworkZoomDialog"'));
  assert.ok(html.includes('id="badgeArtworkZoomImage"'));
  assert.ok(html.includes('novelight-scout-badge-zoom.js'));
});

test('badge artwork zoom copies the active detail artwork and supports keyboard access', async () => {
  const script = await readFile('novelight-scout-badge-zoom.js', 'utf8');

  assert.ok(script.includes("document.getElementById('badgeDialogArtwork')"));
  assert.ok(script.includes("document.getElementById('badgeDialogArtworkImage')"));
  assert.ok(script.includes('sourceImage.currentSrc || source'));
  assert.ok(script.includes("event.key !== 'Enter' && event.key !== ' '"));
  assert.ok(script.includes('zoomDialog.showModal()'));
  assert.ok(script.includes("zoomDialog.addEventListener('close'"));
});

test('badge artwork zoom is a large centered modal surface', async () => {
  const styles = await readFile('novelight-scout-badge-zoom.css', 'utf8');

  assert.match(styles, /width: min\(640px, 80vw, calc\(100dvh - 112px\)\);/u);
  assert.match(styles, /place-items: center;/u);
  assert.match(styles, /::backdrop/u);
  assert.match(styles, /cursor: zoom-in;/u);
});
