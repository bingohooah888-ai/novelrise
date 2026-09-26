import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';

const scoutRecordSource = readFileSync(
  new URL('../novelight-scout-record.js', import.meta.url),
  'utf8'
);
const lockedArtworkUrl = new URL(
  '../assets/scout-badges/unearned-locked.svg',
  import.meta.url
);

test('unearned scout badges use the locked artwork instead of canonical artwork', () => {
  assert.match(
    scoutRecordSource,
    /const unearnedBadgeArtworkPath = 'assets\/scout-badges\/unearned-locked\.svg';/
  );
  assert.match(
    scoutRecordSource,
    /function badgeArtworkPath\(row\) \{[\s\S]*?row\.status !== 'earned'[\s\S]*?return unearnedBadgeArtworkPath;[\s\S]*?return badgeArtworkPaths\[row\.badge_id\] \|\| '';/
  );
  assert.match(
    scoutRecordSource,
    /function createBadgeIcon\(row\) \{[\s\S]*?const artworkPath = badgeArtworkPath\(row\);/
  );
  assert.match(
    scoutRecordSource,
    /function renderBadgeDialogArtwork\(row\) \{[\s\S]*?const artworkPath = badgeArtworkPath\(row\);/
  );
});

test('locked scout badge artwork is a separate asset', () => {
  assert.equal(existsSync(fileURLToPath(lockedArtworkUrl)), true);
  const svg = readFileSync(lockedArtworkUrl, 'utf8');
  assert.match(svg, /<svg[\s>]/);
  assert.match(svg, /width="384" height="384"/);
});
