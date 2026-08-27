import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { URL } from 'node:url';

const root = new URL('../', import.meta.url);

async function pricingScript() {
  const html = await readFile(new URL('pricing.html', root), 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length > 0, 'pricing inline script is missing');
  return scripts.at(-1)[1];
}

test('pricing buttons still open checkout when Supabase CDN is unavailable', async () => {
  const script = await pricingScript();
  const elements = {
    status: { textContent: '' },
    standard: { disabled: false, onclick: null },
    premium: { disabled: false, onclick: null }
  };
  const storage = new Map([
    [
      'sb-fiepaguycecrredwrcwx-auth-token',
      JSON.stringify({ access_token: 'stored-access-token' })
    ]
  ]);
  const requests = [];
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

test('pricing redirects anonymous users even when Supabase CDN is unavailable', async () => {
  const script = await pricingScript();
  const elements = {
    status: { textContent: '' },
    standard: { disabled: false, onclick: null },
    premium: { disabled: false, onclick: null }
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
