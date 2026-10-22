import assert from 'node:assert/strict';
import test from 'node:test';
import { createSpecialPageHandler } from '../api/special-page.js';
import {
  projectRightsDigest,
  contentRightsDigest
} from '../api/_lib/special-core.js';

const projectId = '11111111-1111-4111-8111-111111111111';
const contentId = '22222222-2222-4222-8222-222222222222';
const now = new Date('2026-10-23T12:00:00Z');
const project = {
  id: projectId, slug: 'rights-approved-special', status: 'published',
  title: '許諾された特別企画', kind: 'ss', summary: '説明',
  description: '企画説明', author_name: '作家', author_bio: '',
  work_title: '作品', work_description: '', novel_id: 50,
  starts_at: null, ends_at: null,
  author_x_url: null, author_other_url: null, work_url: null
};
const item = {
  id: contentId, project_id: projectId, title: '特別回', kind: 'ss',
  status: 'published', mode: 'episode', episode_id: 10
};
const validRight = (kind, approved_digest, content_id = null) => ({
  project_id: projectId, kind, content_id, approved_digest,
  confirmed_at: '2026-10-22T12:00:00Z', revoked_at: null,
  valid_from: null, expires_at: null
});
const grants = [
  validRight('project', projectRightsDigest(project)),
  validRight('content', contentRightsDigest(item), contentId)
];

function fakeDb(novelStatus) {
  const tables = {
    special_projects: [project], special_permissions: grants,
    special_contents: [item], episodes: [
      { id: 10, novel_id: 50, status: 'published' }
    ], novels: [{ id: 50, status: novelStatus }]
  };
  return {
    from(table) {
      if (!Object.hasOwn(tables, table)) throw new Error('Unknown ' + table);
      let current = tables[table].slice();
      const builder = {
        select() { return this; },
        eq(key, value) {
          current = current.filter((row) => String(row[key]) === String(value));
          return this;
        },
        in(key, values) {
          const ids = new Set(values.map(String));
          current = current.filter((row) => ids.has(String(row[key])));
          return this;
        },
        order() { return this; },
        limit(n) { current = current.slice(0, n); return this; },
        then(resolve, reject) {
          return Promise.resolve({ data: current, error: null }).then(resolve, reject);
        }
      };
      return builder;
    }
  };
}
function response() {
  return {
    headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    send(body) { this.body = body; return this; },
    end() { return this; }
  };
}
test('作品の公開状態が変わったら特別企画から未公開話へのリンクを隠す', async () => {
  const handler = createSpecialPageHandler(() => fakeDb('draft'), () => now);
  const res = response();
  await handler({ method: 'GET', query: { slug: project.slug } }, res);
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /許諾された特別企画/);
  assert.doesNotMatch(res.body, /episode\\.html\\?id=10/);
  assert.doesNotMatch(res.body, /novel\\.html\\?id=50/);
});
test('元作品とエピソードが両方公開中ならゲスト向け導線を表示する', async () => {
  const handler = createSpecialPageHandler(() => fakeDb('published'), () => now);
  const res = response();
  await handler({ method: 'GET', query: { slug: project.slug } }, res);
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /episode\\.html\\?id=10/);
  assert.match(res.body, /novel\\.html\\?id=50/);
});
