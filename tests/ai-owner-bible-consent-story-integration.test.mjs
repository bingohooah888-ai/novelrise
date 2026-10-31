import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const html = await readFile('story-notes.html', 'utf8');
const panel = await readFile('novelight-ai-bible-consent-panel.js', 'utf8');

test('private consent mounts after owner verification and note load', () => {
  const owner = html.indexOf('result.data.user_id!==session.user.id');
  const notes = html.indexOf(
    'await loadCharacters();await loadNotes();ready=true;'
  );
  const call = 'NovelightAiBibleConsentPanel.attach(';
  const mount = html.indexOf(call);
  assert.ok(owner >= 0 && owner < notes && notes < mount);
  assert.equal(html.split(call).length, 2);
  assert.match(html, /src="novelight-ai-bible-consent-panel\.js"/);
  assert.match(html, /src="novelight-ai-bible-owner-studio\.js"/);
  assert.doesNotMatch(html, /novelight_ai_consent_grant/);
});

test('consent is off-DOM until owner API verification', () => {
  const fetched = panel.indexOf('let data = await fetchView();');
  const checked = panel.indexOf('if (!data || !(await current()))');
  const mounted = panel.indexOf('host.appendChild(section);');
  assert.ok(fetched >= 0 && fetched < checked && checked < mounted);
  assert.match(panel, /checkbox\.checked !== true/);
  assert.match(panel, /button\.addEventListener\('click', async/);
  assert.doesNotMatch(panel, /innerHTML\s*=/);
});

test('consent controls use private styles', () => {
  const names = [
    'novelight-ai-bible-consent-section',
    'novelight-ai-bible-consent-rows',
    'novelight-ai-bible-consent-row',
    'novelight-ai-bible-consent-label'
  ];
  for (const name of names) {
    assert.ok(html.includes('.' + name));
    assert.ok(panel.includes(name));
  }
});
