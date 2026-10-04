import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(
  new URL('../admin-trust-safety.html', import.meta.url),
  'utf8'
);

test('Trust & Safety admin page warns that risk is not guilt and does not auto-ban', () => {
  assert.match(html, /Risk Scoreは「不正確定」ではありません/);
  assert.match(html, /同一IPだけで不正扱いせず/);
  assert.match(html, /自動BANは行いません/);
});

test('Trust & Safety admin page uses authenticated admin API actions', () => {
  assert.match(html, /\/api\/admin-trust-safety/);
  assert.match(html, /Bearer \$\{s\.access_token\}/);
  assert.match(html, /scan_user/);
  assert.match(html, /signal_action/);
  assert.match(html, /action:'review'/);
});

test('Trust & Safety page exposes campaign hold and human review controls', () => {
  assert.match(html, /キャンペーン配布保留/);
  assert.match(html, /誤検知として除外/);
  assert.match(html, /証拠として確定/);
  assert.match(html, /配布を手動保留/);
  assert.match(html, /不正確認/);
});

test('Trust & Safety page never embeds server-side Supabase secrets', () => {
  assert.doesNotMatch(html, /service_role/i);
  assert.doesNotMatch(html, /SUPABASE_SECRET_KEY/i);
  assert.doesNotMatch(html, /sb_secret_/i);
});
