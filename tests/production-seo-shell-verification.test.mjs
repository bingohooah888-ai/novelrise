import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  expectedSeoShell,
  verifySeoShell
} from '../scripts/verify-production-seo-shell.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
for (const route of ['episode.html', 'novel.html']) {
  test(`${route}: fully verifies the SEO-rewritten no-ID Production shell`, () => {
    const source = readFileSync(join(ROOT, route), 'utf8');
    const template = readFileSync(
      join(ROOT, 'api/seo/templates', route),
      'utf8'
    );
    assert.equal(source, template);
    const rendered = expectedSeoShell(route, template);

    assert.equal(verifySeoShell(route, source, template, rendered), true);
    assert.match(rendered, /<meta name="robots" content="noindex, nofollow">/u);
    assert.match(
      rendered,
      /<link rel="canonical" href="https:\/\/novelight\.jp\//u
    );
    assert.match(
      rendered,
      /<script src="novelight-episode-title-display\.js"><\/script>/u
    );
    assert.notEqual(rendered, source, 'SEO-injected HTML is not the raw shell');

    assert.throws(
      () => verifySeoShell(route, source, template, source),
      /Production SEO shell differs/u,
      'a missing SEO rewrite must fail'
    );
    assert.throws(
      () =>
        verifySeoShell(
          route,
          source,
          template,
          rendered.replace('novelight-episode-title-display.js', 'stale.js')
        ),
      /Production SEO shell differs/u,
      'stale script must fail'
    );
    assert.throws(
      () =>
        verifySeoShell(
          route,
          source,
          template,
          rendered.replace('</body>', '<p>unexpected</p></body>')
        ),
      /Production SEO shell differs/u,
      'unexpected body injection must fail'
    );
    assert.throws(
      () => verifySeoShell(route, source, template + 'stale', rendered),
      /public shell and SEO template differ/u,
      'stale local SEO template must fail'
    );
  });
}

test('only the two approved rewrite routes use the special comparison', () => {
  assert.throws(
    () => expectedSeoShell('episode-edit.html', '<html></html>'),
    /unsupported SEO rewrite route/u
  );
  const checker = readFileSync(
    join(ROOT, 'scripts/verify-production-static.sh'),
    'utf8'
  );
  assert.match(checker, /novel\.html\|episode\.html/u);
  assert.match(checker, /cmp -s "\$route" "\$target"/u);
  assert.match(checker, /novelight-episode-title-display\.js/u);
  const config = readFileSync(join(ROOT, 'vercel.json'), 'utf8');
  const rules = JSON.parse(config).rewrites;
  for (const route of ['episode', 'novel']) {
    assert.ok(
      rules.some(
        (rule) =>
          rule.source === `/${route}.html` &&
          rule.destination === `/api/seo/${route}`
      )
    );
  }
});

test('CLI fails closed on changed Production HTML with relative script path', () => {
  const route = 'episode.html';
  const source = readFileSync(join(ROOT, route), 'utf8');
  const dir = mkdtempSync(join(tmpdir(), 'novelight-seo-check-'));
  const livePath = join(dir, 'response.html');
  try {
    writeFileSync(livePath, expectedSeoShell(route, source));
    let processResult = spawnSync(
      process.execPath,
      ['scripts/verify-production-seo-shell.mjs', route, livePath],
      { cwd: ROOT, encoding: 'utf8' }
    );
    assert.equal(processResult.status, 0, processResult.stderr);
    writeFileSync(livePath, source);
    processResult = spawnSync(
      process.execPath,
      ['scripts/verify-production-seo-shell.mjs', route, livePath],
      { cwd: ROOT, encoding: 'utf8' }
    );
    assert.equal(processResult.status, 1);
    assert.match(processResult.stderr, /Production SEO shell mismatch/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
