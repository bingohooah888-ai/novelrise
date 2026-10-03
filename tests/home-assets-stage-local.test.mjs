import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const sourceZip = path.join(os.homedir(), 'Downloads', 'NOVELIGHT_home_images_dev_bundle.zip');
const targetDir = path.resolve('assets', 'home');
const expected = [
  ['01_hero_pc_2560x1280.png', 2560, 1280, '035fd4bd947526fdfcbc2dcba2240b0d15aa393d0d7be17c9185a61f94913764'],
  ['02_hero_mobile_900x1600.png', 900, 1600, '5a2d766291ad2e5055144e3872e1b7cb2cf4f1998cfa2ee338995e54d1008780'],
  ['03_author_features_1600x900.png', 1600, 900, '488239cbe38f2604ca23504aff73880028dc32d8b18f01eac79190ff88c6d250'],
  ['04_reader_promo_1600x900.png', 1600, 900, '5cad3e04a656f270e90bac2a4ee9222a744dcdc21dfa5de11cb313353ae807c4'],
  ['05_event_teaser_1600x900.png', 1600, 900, '9d6cb3a9ae6d4ee29b48bbc1364eee0c9aee4f6c9291bc865519176517f1cd39'],
  ['05_campaign_official_after_announcement_1600x900.png', 1600, 900, '7e86834eb288f0336a8642e5e6187362eff5019d921860b26207ffc94cc74bdf']
];

test('stage approved home artwork bytes from canonical handoff ZIP', () => {
  assert.ok(fs.existsSync(sourceZip), sourceZip);
  fs.mkdirSync(targetDir, { recursive: true });
  const names = expected.map(([name]) => name);
  const result = spawnSync('tar.exe', ['-xf', sourceZip, '-C', targetDir, ...names], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  for (const [name, width, height, sha] of expected) {
    const bytes = fs.readFileSync(path.join(targetDir, name));
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', name);
    assert.equal(bytes.readUInt32BE(16), width, name);
    assert.equal(bytes.readUInt32BE(20), height, name);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), sha, name);
  }
});
