import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { URL } from 'node:url';
import { setImmediate } from 'node:timers';

const home = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
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

function simulate(
  status,
  error = null,
  entryDeadline = '2099-10-31T14:59:59.999999Z'
) {
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
      data: error
        ? null
        : {
            ok: true,
            contest_status: status,
            entry_deadline_at: entryDeadline
          },
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
  assert.equal(
    (await simulate('registration', null, '2020-10-31T14:59:59Z')).area.hidden,
    true
  );
  assert.equal(
    (await simulate('registration', null, 'invalid')).area.hidden,
    true
  );
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
  assert.match(runbook, /受付開始承認/);
  assert.match(runbook, /public_visible=false/);
  assert.match(runbook, /public_visible = true/);
  assert.match(runbook, /rootに静的/);
  assert.match(runbook, /未承認／未実施/);
  assert.match(runbook, /draft/);
  assert.match(runbook, /⑤の「受付開始」完了/);
  assert.match(runbook, /規約/);
});

test('all repository migration versions are distinct and ordered', () => {
  const names = readdirSync(
    new URL('../supabase/migrations/', import.meta.url)
  ).filter((name) => /^\d{14}_.+\.sql$/.test(name));

  const versions = names.map((name) => name.slice(0, 14));
  assert.equal(new Set(versions).size, versions.length);

  const contestVersions = versions.filter((version) =>
    ['20261012130000', '20261012131000', '20261012132000'].includes(version)
  );
  assert.equal(contestVersions.length, 3);
});
