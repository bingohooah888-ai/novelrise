import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { URL } from 'node:url';

const root = new URL('../', import.meta.url);

async function pricingHtml() { return readFile(new URL('pricing.html', root), 'utf8'); }
async function pricingScript() {
  const html = await pricingHtml();
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gi)];
  assert.ok(scripts.length > 0, 'pricing inline script is missing');
  return scripts.at(-1)[1];
}

function elements() {
  return {
    status: { textContent: '', dataset: {}, scrollIntoView() {} },
    standard: { disabled: false, onclick: null, textContent: '' },
    premium: { disabled: false, onclick: null, textContent: '' }
  };
}

test('pricing wires Standard activation and Premium checkout without blocking on optional analytics dependencies', async () => {
  const html = await pricingHtml();
  const inlineIndex = html.indexOf("const AUTH_STORAGE_KEY='sb-");
  const sharedClientIndex = html.indexOf('<script async src="novelight-client.js"');
  const supabaseIndex = html.indexOf('<script async src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"');
  assert.notEqual(inlineIndex, -1);
  assert.notEqual(sharedClientIndex, -1);
  assert.notEqual(supabaseIndex, -1);
  assert.ok(sharedClientIndex < inlineIndex);
  assert.ok(inlineIndex < supabaseIndex);
  assert.match(html, /\/api\/activate-beta-standard/u);
  assert.match(html, /\/api\/create-checkout-session/u);
});

test('Premium pricing uses the stored access token without waiting on a stuck Supabase auth lock', async () => {
  const script = await pricingScript();
  const els = elements();
  const storage = new Map([['sb-fiepaguycecrredwrcwx-auth-token', JSON.stringify({ access_token: 'stored-access-token' })]]);
  const requests = [];
  const location = { href: 'pricing.html' };
  let getSessionCalls = 0;
  const context = vm.createContext({
    console: { error() {} },
    document: { getElementById(id) { return els[id]; } },
    localStorage: { getItem(key) { return storage.get(key) ?? null; }, removeItem(key) { storage.delete(key); } },
    location,
    supabase: { createClient() { return { auth: { getSession() { getSessionCalls += 1; return new Promise(() => {}); }, async signOut() {} } }; } },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, status: 200, async json() { return { url: 'https://checkout.stripe.com/c/pay/cs_live_novelight', mode: 'checkout' }; } };
    }
  });
  vm.runInContext(script, context);
  await els.premium.onclick();
  assert.equal(getSessionCalls, 0);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/create-checkout-session');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer stored-access-token');
  assert.equal(location.href, 'https://checkout.stripe.com/c/pay/cs_live_novelight');
});

test('Standard activation uses the stored token and never opens Stripe checkout', async () => {
  const script = await pricingScript();
  const els = elements();
  const storage = new Map([['sb-fiepaguycecrredwrcwx-auth-token', JSON.stringify({ access_token: 'stored-access-token' })]]);
  const requests = [];
  const location = { href: 'pricing.html' };
  const context = vm.createContext({
    console: { error() {} },
    document: { getElementById(id) { return els[id]; } },
    localStorage: { getItem(key) { return storage.get(key) ?? null; }, removeItem(key) { storage.delete(key); } },
    location,
    fetch: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, status: 200, async json() { return { plan: 'standard', paymentStatus: 'beta_free', mode: 'beta_free' }; } };
    }
  });
  vm.runInContext(script, context);
  await els.standard.onclick();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/activate-beta-standard');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer stored-access-token');
  assert.equal(location.href, 'pricing.html');
  assert.match(els.status.textContent, /クレジットカード登録も請求もありません/u);
});

test('Premium pricing recovers when checkout response body never finishes', async () => {
  const script = await pricingScript();
  const els = elements();
  const storage = new Map([['sb-fiepaguycecrredwrcwx-auth-token', JSON.stringify({ access_token: 'stored-access-token' })]]);
  const location = { href: 'pricing.html' };
  const context = vm.createContext({
    console: { error() {} },
    document: { getElementById(id) { return els[id]; } },
    localStorage: { getItem(key) { return storage.get(key) ?? null; }, removeItem(key) { storage.delete(key); } },
    location,
    setTimeout(callback) { Promise.resolve().then(callback); return 1; },
    fetch: async () => ({ ok: true, status: 200, json() { return new Promise(() => {}); } })
  });
  vm.runInContext(script, context);
  await els.premium.onclick();
  assert.equal(els.standard.disabled, false);
  assert.equal(els.premium.disabled, false);
  assert.equal(els.premium.textContent, 'Premiumを申し込む / 管理');
  assert.equal(els.status.textContent, '決済・契約管理画面の準備がタイムアウトしました。もう一度お試しください。');
  assert.equal(location.href, 'pricing.html');
});

test('pricing redirects anonymous users even when Supabase CDN is unavailable', async () => {
  const script = await pricingScript();
  const els = elements();
  const location = { href: 'pricing.html' };
  const context = vm.createContext({
    console: { error() {} },
    document: { getElementById(id) { return els[id]; } },
    localStorage: { getItem() { return null; }, removeItem() {} },
    location,
    fetch: async () => { throw new Error('fetch should not run for anonymous users'); }
  });
  vm.runInContext(script, context);
  await els.standard.onclick();
  assert.equal(location.href, 'login.html?redirect=pricing.html');
});
