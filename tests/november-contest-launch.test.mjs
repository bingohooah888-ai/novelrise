import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';

const home = readFileSync(
  new URL('../index.html', import.meta.url),
  'utf8'
);
const widget = readFileSync(
  new URL('../novelight-contest-home-promo.js', import.meta.url),
  'utf8'
);
const css = readFileSync(
  new URL('../novelight-contest-home-promo.css', import.meta.url),
  'utf8'
);
const runbook = readFileSync(
  new URL(
    '../docs/reports/NOVEMBER-CONTEST-STEP05-REGISTRATION-RUNBOOK.md',
    import.meta.url
  ),
  'utf8'
);

function simulate(status, error = null) {
  const nodes = new Map();
  for (const id of [
    'novelightContestHomePromo',
    'novelightContestHomePromoDescription',
    'novelightContestHomePromoLink'
  ]) {
    nodes.set(id, { hidden: true, textContent: '' });
  }
  const document = { getElementById: (id) => nodes.get(id) ?? null };
  const client = {
    rpc: async () => ({
      data: error ? null : { ok: true, contest_status: status },
      error
    })
  };
  const script = new Function('document', 'client', widget);
  script(document, client);
  return new Promise((resolve) => {
    setImmediate(() => {
      resolve({
        area: nodes.get('novelightContestHomePromo'),
        description: nodes.get('novelightContestHomePromoDescription'),
        link: nodes.get('novelightContestHomePromoLink')
      });
    });
  });
}

test('home banner is present but hidden before launch', async () => {
  assert.match(home, /id="novelightContestHomePromo"[^>]*hidden/);
  assert.match(home, /src="novelight-contest-home-promo\.js"/);
  assert.match(home, /href="novelight-contest-home-promo\.css"/);
  assert.match(css, /\.novelight-contest-home-promo\[hidden\]/);
  assert.equal((await simulate('draft')).area.hidden, true);
  assert.equal((await simulate('review')).area.hidden, true);
  assert.equal((await simulate('cancelled')).area.hidden, true);
});

test('home banner advertises enrollment only after opening', async () => {
  const started = await simulate('registration');
  assert.equal(started.area.hidden, false);
  assert.equal(started.link.textContent, 'エントリーする →');
  assert.match(started.description.textContent, /10月31日23:59/);
  const active = await simulate('active');
  assert.equal(active.area.hidden, false);
  assert.equal(active.link.textContent, '参加作品を読む →');
  assert.equal(
    (await simulate('active', new Error('network down'))).area.hidden,
    true
  );
});

test('registration runbook does not allow premature launch', () => {
  assert.match(runbook, /本番承認/);
  assert.match(runbook, /未承認／未実施/);
  assert.match(runbook, /draft/);
  assert.match(runbook, /⑤の「受付開始」完了/);
  assert.match(runbook, /規約/);
});
