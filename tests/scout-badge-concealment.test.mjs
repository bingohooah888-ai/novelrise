import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

const source = readFileSync(
  new URL('../novelight-scout-record.js', import.meta.url),
  'utf8'
);
const artwork = readFileSync(
  new URL('../assets/scout-badges/unearned-locked.png', import.meta.url)
);

test('unearned Reader/Author SCOUT badges hide canonical artwork until earned', () => {
  assert.match(
    source,
    /const unearnedBadgeArtworkPath = 'assets\/scout-badges\/unearned-locked\.png';/
  );
  assert.match(
    source,
    /function badgeArtworkPath\(row\) \{[\s\S]*?row\.status !== 'earned' && row\.badge_category !== 'limited'[\s\S]*?return unearnedBadgeArtworkPath;[\s\S]*?badgeArtworkPaths\[row\.badge_id\]/
  );
  assert.match(
    source,
    /function createBadgeIcon\(row\) \{[\s\S]*?row\.status !== 'earned' && row\.badge_category !== 'limited'[\s\S]*?badge-icon-locked/
  );
  assert.match(
    source,
    /function renderBadgeDialogArtwork\(row\) \{[\s\S]*?const locked = row\.status !== 'earned' && row\.badge_category !== 'limited'[\s\S]*?badgeArtworkPath\(row\)/
  );
});

test('limited SCOUT badges always use their canonical artwork even before earning', () => {
  assert.match(
    source,
    /limited_founding_author: 'assets\/founding-authors-badge-2026\.png'/
  );
  assert.match(
    source,
    /limited_beta_participant: 'assets\/scout-badges\/limited_beta_participant\.png'/
  );
});

test('approved lock artwork remains byte-exact 1254x1254 PNG', () => {
  assert.equal(artwork.toString('hex', 0, 8), '89504e470d0a1a0a');
  assert.equal(artwork.readUInt32BE(16), 1254);
  assert.equal(artwork.readUInt32BE(20), 1254);
  assert.equal(artwork.length, 1843639);
  assert.equal(
    createHash('sha256').update(artwork).digest('hex'),
    '33b4056b430ab1bd54e0f614e1aa6f040def46da31f5fcc85a5b1ffe7c60fe98'
  );
});
