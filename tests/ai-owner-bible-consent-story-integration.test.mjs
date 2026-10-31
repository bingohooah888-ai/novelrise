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

test('consent disclosures and buttons keep readable light/dark contrast', () => {
  const intro = html.match(
    /\.novelight-ai-bible-consent-section > p \{[^}]*color:(#[0-9a-f]{6})/i
  )?.[1];
  const button = html.match(
    /\.novelight-ai-bible-consent-row \.btn \{[^}]*color:(#[0-9a-f]{6})/i
  )?.[1];
  const buttonBackground = html.match(
    /\.novelight-ai-bible-consent-row \.btn \{[^}]*background:(#[0-9a-f]{6})/i
  )?.[1];

  function luminance(hex) {
    const channels = hex.slice(1).match(/../g).map((pair) => {
      const channel = parseInt(pair, 16) / 255;
      return channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  }

  function contrast(a, b) {
    const light = Math.max(luminance(a), luminance(b));
    const dark = Math.min(luminance(a), luminance(b));
    return (light + 0.05) / (dark + 0.05);
  }

  assert.ok(intro && button && buttonBackground);
  // The section inherits the dark .panel surface; consent rows use a pale surface.
  assert.ok(contrast(intro, '#0d1d2b') >= 4.5, 'section text must be readable on dark');
  assert.ok(
    contrast(button, buttonBackground) >= 4.5,
    'action labels must be readable on light buttons'
  );
  assert.match(html, /\.novelight-ai-bible-consent-row \.btn:focus-visible/);
});
