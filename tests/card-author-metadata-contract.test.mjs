import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('novelight-user-safety.js', 'utf8');

assert.match(source, /novelight_public_card_authors/);
assert.match(source, /author_name/);
assert.match(
  source,
  /const input = await hydrateAuthorNames\(client, source\)/
);

console.log('card author metadata contract: ok');
