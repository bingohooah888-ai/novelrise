import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const roomCss = await readFile('novelight-author-room.css', 'utf8');
const iconNames = [
  'ChatGPT Image 2026年9月7日 01_37_20 (1).png',
  'ChatGPT Image 2026年9月7日 01_37_20 (2).png',
  'ChatGPT Image 2026年9月7日 01_37_20 (3).png',
  'ChatGPT Image 2026年9月7日 01_37_21 (4).png',
  'ChatGPT Image 2026年9月7日 01_37_22 (5).png',
  'ChatGPT Image 2026年9月7日 01_37_22 (6).png',
  'ChatGPT Image 2026年9月7日 01_37_22 (7).png',
  'ChatGPT Image 2026年9月7日 01_37_22 (8).png',
  'ChatGPT Image 2026年9月7日 01_37_22 (9).png',
  'ChatGPT Image 2026年9月7日 01_37_23 (10).png',
];
const iconAssets = iconNames.map((name) => `assets/author-room/${name}`);

test('author room uses all ten uploaded icon assets in order', async () => {
  await Promise.all(iconAssets.map((path) => access(path)));

  iconAssets.forEach((path, index) => {
    assert.ok(roomCss.includes(path), `missing author-room icon ${index + 1}`);
  });

  for (let index = 1; index <= 5; index += 1) {
    const selector = `.action-card:nth-child(${index}) .action-icon`;
    assert.ok(roomCss.includes(selector));
  }

  for (let index = 1; index <= 5; index += 1) {
    const selector = `.metric:nth-child(${index}) .metric-icon`;
    assert.ok(roomCss.includes(selector));
  }
});
