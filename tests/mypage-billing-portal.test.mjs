import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const mypage = await readFile('mypage.html', 'utf8');

test('author home exposes billing management only for paid plans', () => {
  assert.match(
    mypage,
    /<button id="billingPortal" type="button" hidden>契約を管理・解約<\/button>/u
  );
  assert.match(
    mypage,
    /billingPortal\.hidden=!\['standard','premium'\]\.includes\(currentPlan\)/u
  );
});

test('billing management opens an authenticated Stripe customer portal session', () => {
  assert.match(mypage, /fetch\('\/api\/create-billing-portal-session'/u);
  assert.match(mypage, /method:'POST'/u);
  assert.match(
    mypage,
    /Authorization:'Bearer '\+session\.access_token/u
  );
  assert.match(mypage, /location\.href=data\.url/u);
});

test('billing management fails closed when the session or portal request is unavailable', () => {
  assert.match(mypage, /if\(!session\?\.access_token\)/u);
  assert.match(mypage, /if\(!r\.ok\|\|!data\.url\)throw new Error/u);
  assert.match(
    mypage,
    /契約管理画面を開けませんでした。時間をおいて再度お試しください。/u
  );
});
