import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const html = await readFile('story-notes.html', 'utf8');
const panel = await readFile('novelight-ai-bible-consent-panel.js', 'utf8');

test('private author workspace wires consent only after verified ownership and loaded notes', () => {
  const auth = html.indexOf('result.data.user_id!==session.user.id');
  const loaded = html.indexOf('await loadCharacters();await loadNotes();ready=true;');
  const consent = html.indexOf('NovelightAiBibleConsentPanel.attach({client,novelId,ownerId:session.user.id})');
  assert.ok(auth >= 0 && loaded > auth && consent > loaded);
  assert.equal(html.match(/NovelightAiBibleConsentPanel\.attach\(/g)?.length, 1);
  assert.match(html, /src="novelight-ai-bible-consent-panel\.js"/);
  assert.match(html, /src="novelight-ai-bible-owner-studio\.js"/);
  assert.doesNotMatch(html, /novelight_ai_consent_grant|NOVELIGHT_AI_CONSENT_UI_ENABLED\s*=\s*true/);
});

test('consent UI remains entirely server-authorized and does not auto-submit consent', () => {
  assert.match(panel, /const data = await response\.json\(\)/);
  assert.match(panel, /if \(!data \|\| !\(await current\(\)\)\) return false/);
  assert.match(panel, /host\.appendChild\(section\)/);
  assert.match(panel, /checkbox\.checked !== true/);
  assert.match(panel, /button\.addEventListener\('click', async/);
  assert.doesNotMatch(panel, /innerHTML\s*=/);
});

test('consent controls have accessible, isolated styles in the private workspace', () => {
  for (const className of [
    'novelight-ai-bible-consent-section',
    'novelight-ai-bible-consent-rows',
    'novelight-ai-bible-consent-row',
    'novelight-ai-bible-consent-label'
  ]) {
    assert.ok(html.includes('.' + className));
    assert.ok(panel.includes("'" + className + "'") || panel.includes(' ' + className + "'"));
  }
});
