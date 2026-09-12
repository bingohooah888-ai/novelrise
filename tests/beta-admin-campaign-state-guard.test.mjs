import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

function read(path) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

const adminHtml = read('admin-beta-authors.html');

test('beta admin uses the fixed September 30 release date example', () => {
  assert.match(adminHtml, /placeholder="例：2026年9月30日"/);
  assert.doesNotMatch(adminHtml, /placeholder="例：2026年9月下旬"/);
});

test('beta admin confirms campaign state transitions before persisting them', () => {
  assert.match(adminHtml, /let persistedCampaignState=null;/);
  assert.match(adminHtml, /function confirmCampaignStateChange\(nextState\)/);
  assert.match(
    adminHtml,
    /if\(!persistedCampaignState\|\|nextState===persistedCampaignState\)return true;/
  );
  assert.match(adminHtml, /window\.confirm\(message\)/);
  assert.match(adminHtml, /if\(!confirmCampaignStateChange\(nextState\)\)/);
  assert.match(adminHtml, /新規先行登録受付は停止します/);
  assert.match(adminHtml, /先行登録受付を再開します/);
});

test('beta admin keeps same-state saves confirmation-free', () => {
  assert.match(
    adminHtml,
    /if\(!persistedCampaignState\|\|nextState===persistedCampaignState\)return true;/
  );
});
