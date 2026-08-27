import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { URL } from 'node:url';

const root = new URL('../', import.meta.url);

async function pricingHtml() {
  return readFile(new URL('pricing.html', root), 'utf8');
}

async function pricingScript() {
  const html = await pricingHtml();
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gi)];
  assert.ok(scripts.length > 0, 'pricing inline script is missing');
  return scripts.at(-1)[1];
}

test('pricing wires checkout without blocking on optional analytics dependencies', async () => {
  const html = await pricingHtml();
  const inlineIndex = html.indexOf("const AUTH_STORAGE_KEY='sb-");
  const sharedClientIndex = html.indexOf(
    '<script async src="novelight-client.js"'
  );
  const supabaseIndex = html.indexOf(
    '<script async src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"'
  );

  assert.notEqual(inlineIndex, -1);
  assert.notEqual(sharedClientIndex, -1);
  assert.notEqual(supabaseIndex, -1);
  assert.ok(sharedClientIndex < inlineIndex);
  assert.ok(inlineIndex < supabaseIndex);
});

test('pricing uses the stored access token without waiting on a stuck Supabase auth lock', async () => {
  const script = await pricingScript();
  const elements = {
    status: { textContent: '' },
    standard: { disabled: false, onclick: null, textContent: '' },
    premium: { disabled: false, onclick: null, textContent: '' }
  };
  const storage = new Map([
    [
      'sb-fiepaguycecrredwrcwx-auth-token',
      JSON.stringify({ access_token: 'stored-access-token' })
    ]
  ]);
  const requests = [];
  const location = { href: 'pricing.html' };
  let getSessionCalls = 0;

  const context = vm.createContext({
    console: { error() {} },
    document: {
      getElementById(id) {
        return elements[id];
      }
    },
    localStorage: {
      getItem(key) {
        return storage.get(key) ?? null;
      },
      removeItem(key) {
        storage.delete(key);
      }
    },
    location,
    supabase: {
      createClient() {
        return {
          auth: {
            getSession() {
              getSessionCalls += 1;
              return new Promise(() => {});
            },
            async signOut() {}
          }
        };
      }
    },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        status: 200,
        async json() {
          return { url: 'https://checkout.stripe.com/c/pay/cs_live_novelight' };
        }
      };
    }
  });

  vm.runInContext(script, context);

  assert.equal(typeof elements.standard.onclick, 'function');
  assert.equal(typeof elements.premium.onclick, 'function');

  await elements.standard.onclick();

  assert.equal(getSessionCalls, 0);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/create-checkout-session');
  assert.equal(
    requests[0].options.headers.Authorization,
    'Bearer stored-access-token'
  );
  assert.equal(
    location.href,
    'https://checkout.stripe.com/c/pay/cs_live_novelight'
  );
});

test('pricing recovers when checkout response body never finishes', async () => {
  const script = await pricingScript();
  const elements = {
    status: { textContent: '' },
    standard: { disabled: false, onclick: null, textContent: '' },
    premium: { disabled: false, onclick: null, textContent: '' }
  };
  const storage = new Map([
    [
      'sb-fiepaguycecrredwrcwx-auth-token',
      JSON.stringify({ access_token: 'stored-access-token' })
    ]
  ]);
  const location = { href: 'pricing.html' };

  const context = vm.createContext({
    console: { error() {} },
    document: {
      getElementById(id) {
        return elements[id];
      }
    },
    localStorage: {
      getItem(key) {
        return storage.get(key) ?? null;
      },
      removeItem(key) {
        storage.delete(key);
      }
    },
    location,
    setTimeout(callback) {
      queueMicrotask(callback);
      return 1;
    },
    fetch: async () => ({
      ok: true,
      status: 200,
      json() {
        return new Promise(() => {});
      }
    })
  });

  vm.runInContext(script, context);
  await elements.standard.onclick();

  assert.equal(elements.standard.disabled, false);
  assert.equal(elements.premium.disabled, false);
  assert.equal(elements.standard.textContent, 'Standardを申し込む / 管理');
  assert.equal(
    elements.status.textContent,
    '決済・契約管理画面の準備がタイムアウトしました。もう一度お試しください。'
  );
  assert.equal(location.href, 'pricing.html');
});

test('pricing redirects anonymous users even when Supabase CDN is unavailable', async () => {
  const script = await pricingScript();
  const elements = {
    status: { textContent: '' },
    standard: { disabled: false, onclick: null, textContent: '' },
    premium: { disabled: false, onclick: null, textContent: '' }
  };
  const location = { href: 'pricing.html' };

  const context = vm.createContext({
    console: { error() {} },
    document: {
      getElementById(id) {
        return elements[id];
      }
    },
    localStorage: {
      getItem() {
        return null;
      },
      removeItem() {}
    },
    location,
    fetch: async () => {
      throw new Error('fetch should not run for anonymous users');
    }
  });

  vm.runInContext(script, context);
  await elements.standard.onclick();

  assert.equal(location.href, 'login.html?redirect=pricing.html');
});
