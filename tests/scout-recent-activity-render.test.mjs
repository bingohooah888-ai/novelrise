import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync('novelight-scout-record.js', 'utf8');
const start = source.indexOf('  function renderActivity(rows) {');
const end = source.indexOf('  function renderSeedHistory(', start);

assert.ok(start >= 0 && end > start, 'SCOUT recent activity renderer exists');
const renderSource = source.slice(start, end);

function element(tag = 'div') {
  return {
    tag,
    className: '',
    textContent: '',
    innerHTML: '',
    children: [],
    append(...children) {
      this.children.push(...children);
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    replaceChildren(...children) {
      this.children = [...children];
      this.innerHTML = '';
    }
  };
}

function render(rows) {
  const host = element();
  const values = {};
  const document = {
    getElementById(id) {
      return id === 'activityList' ? host : null;
    },
    createElement(tag) {
      return element(tag);
    }
  };
  const fn = vm.runInNewContext(
    `${renderSource}\nrenderActivity`,
    {
      document,
      n: String,
      dateTime: (value) => value,
      setText: (id, value) => {
        values[id] = value;
      },
      activityLabels: {
        valid_read: '有効読書',
        light_seed_sent: 'LIGHT SEED',
        star_rating_set: '☆評価',
        comment_posted: 'コメント'
      }
    }
  );
  fn(rows);
  return { host, values };
}

test('SCOUT recent activity renders valid reads and LIGHT SEED sends', () => {
  const rows = [
    {
      event_type: 'valid_read',
      novel_title: '作品A',
      occurred_at: '2026-10-14 20:00'
    },
    {
      event_type: 'light_seed_sent',
      novel_title: '作品B',
      occurred_at: '2026-10-14 21:00'
    }
  ];
  const { host, values } = render(rows);
  assert.equal(values.statActivity, '2');
  assert.equal(host.children.length, 2);
  assert.equal(host.children[0].children[0].children[0].textContent, '有効読書 · 作品A');
  assert.equal(host.children[1].children[0].children[0].textContent, 'LIGHT SEED · 作品B');
  assert.equal(host.children[1].children[0].children[1].textContent, '2026-10-14 21:00');
});

test('SCOUT recent activity shows at most twelve of the newest returned events', () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({
    event_type: 'valid_read',
    novel_title: `作品${i}`,
    occurred_at: `2026-10-14 ${i}`
  }));
  const { host, values } = render(rows);
  assert.equal(values.statActivity, '20');
  assert.equal(host.children.length, 12);
  assert.equal(host.children[11].children[0].children[0].textContent, '有効読書 · 作品11');
});

test('SCOUT recent activity retains the empty-state message when there are no events', () => {
  const { host, values } = render([]);
  assert.equal(values.statActivity, '0');
  assert.equal(host.children.length, 0);
  assert.match(host.innerHTML, /まだ表示できるSCOUT活動はありません/u);
});
