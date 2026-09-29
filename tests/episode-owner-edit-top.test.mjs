import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const episodeHtml = fs.readFileSync(
  new URL('../episode.html', import.meta.url),
  'utf8'
);
const episodeHeartCss = fs.readFileSync(
  new URL('../novelight-episode-heart.css', import.meta.url),
  'utf8'
);

test('owner episode edit action is promoted without changing reader markup', () => {
  assert.match(
    episodeHtml,
    /<div class="meta">[\s\S]*?\$\{isAuthor\?`<a class="action" href="episode-edit\.html\?id=/
  );
  assert.match(
    episodeHeartCss,
    /\.novelight-page-episode \.meta>a\.action\[href\^="episode-edit\.html\?id="\]\{position:absolute;top:28px;right:42px/
  );
  assert.match(
    episodeHeartCss,
    /\.novelight-page-episode \.card:has\(\.meta>a\.action\[href\^="episode-edit\.html\?id="\]\) \.novel-title\{padding-right:112px\}/
  );
});
