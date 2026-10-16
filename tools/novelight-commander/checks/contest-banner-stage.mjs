import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import JSZip from 'jszip';
import { inspectContestBannerZip } from '../src/contest-banner-stage.js';

test('NLO contest asset bridge stays on a fixed Draft PR and action', () => {
  const source = readFileSync(
    new URL('../src/contest-banner-stage.js', import.meta.url),
    'utf8'
  );
  const bridge = readFileSync(
    new URL('../src/github-bridge-core.js', import.meta.url),
    'utf8'
  );
  assert.match(source, /const PR = 2305;/);
  assert.match(source, /feat\/contest-home-responsive-banner-20261016/);
  assert.match(source, /pr\.draft/);
  assert.match(source, /CHAT_APPROVED/);
  assert.match(bridge, /\['contest_banner_stage', actionContestBannerStageBridge\]/);
});

test('NLO refuses unexpected ZIP contents and unapproved images', async () => {
  const empty = new JSZip();
  empty.file('unrelated.webp', Buffer.from('not approved'));
  await assert.rejects(
    inspectContestBannerZip(await empty.generateAsync({ type: 'nodebuffer' })),
    /two approved Star Festival banners/
  );

  const corrupt = new JSZip();
  corrupt.file('assets/contest/starfestival-entry-desktop.webp', Buffer.from('RIFFjunkWEBP'));
  corrupt.file('assets/contest/starfestival-entry-mobile.webp', Buffer.from('RIFFjunkWEBP'));
  await assert.rejects(
    inspectContestBannerZip(await corrupt.generateAsync({ type: 'nodebuffer' })),
    /hash or byte count mismatch/
  );
});
