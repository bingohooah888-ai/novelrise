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
  return scripts.at(-1)[1];
}

test('pricing puts checkout status immediately after plans and before legal billing copy', async () => {
  const html = await pricingHtml();
  const statusIndex = html.indexOf('id="status"');
  const billingIndex = html.indexOf('<section class="billing">');

  assert.notEqual(statusIndex, -1);
  assert.notEqual(billingIndex, -1);
  assert.ok(statusIndex < billingIndex);
  assert.match(html, /aria-live="polite"/);
});

test('billing state conflict produces a visible no-charge recovery message and reenables controls', async () => {
  const script = await pricingScript();
  const elements = {
    status: {
      textContent: '',
      dataset: {},
      scrollIntoViewCalls: 0,
      scrollIntoView() {
        this.scrollIntoViewCalls += 1;
      }
    },
    standard: { disabled: false, onclick: null, textContent: '' },
    premium: { disabled: false, onclick: null, textContent: '' }
  };
  const storage = new Map([
    [
      'sb-fiepaguycecrredwrcwx-auth-token',
      JSON.stringify({ access_token: 'stored-access-token' })
    ]
  ]);
  const location = { href: 'pricing.html', hostname: 'novelrise.vercel.app' };

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
    fetch: async () => ({
      ok: false,
      status: 409,
      async json() {
        return {
          error: 'Billing account needs repair',
          code: 'billing_state_conflict'
        };
      }
    })
  });

  vm.runInContext(script, context);
  await elements.standard.onclick();

  assert.equal(elements.standard.disabled, false);
  assert.equal(elements.premium.disabled, false);
  assert.equal(elements.standard.textContent, 'Standardを申し込む / 管理');
  assert.match(elements.status.textContent, /契約情報の同期に問題/);
  assert.match(elements.status.textContent, /決済は発生していません/);
  assert.equal(elements.status.dataset.visible, 'true');
  assert.equal(elements.status.dataset.kind, 'error');
  assert.equal(elements.status.scrollIntoViewCalls, 1);
  assert.equal(location.href, 'pricing.html');
});
