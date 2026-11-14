import test from 'node:test';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';

test('temporary isolated format diagnostic (no DB or network)', async () => {
  const { format, resolveConfig } = await import('prettier');
  const files = [
    'api/_lib/reader-reward/formal-maintenance-release-gate.js',
    'tests/reader-reward-formal-maintenance-runner.test.mjs',
    'tests/reader-reward-formal-maintenance-safety.test.mjs'
  ];
  for (let i = 0; i < files.length; i++) {
    const content = readFileSync(new URL('../' + files[i], import.meta.url), 'utf8');
    const config = await resolveConfig(files[i]);
    const rendered = await format(content, { ...config, filepath: files[i] });
    console.log('NOVELIGHT_PR2862_FMT_' + i + '=' + Buffer.from(rendered).toString('base64'));
  }
});
