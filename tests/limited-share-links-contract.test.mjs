import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const version = '20260918225815';
const migration = await readFile(
  `supabase/migrations/${version}_limited_share_links.sql`,
  'utf8'
);
const precheck = await readFile(
  `supabase/checks/${version}_limited_share_links_precheck.sql`,
  'utf8'
);
const postcheck = await readFile(
  `supabase/checks/${version}_limited_share_links_postcheck.sql`,
  'utf8'
);
const rollback = await readFile(
  `supabase/rollback/${version}_limited_share_links_rollback.sql`,
  'utf8'
);
const runtime = await readFile('novelight-limited-share.js', 'utf8');
const manager = await readFile('share-link.html', 'utf8');
const reader = await readFile('shared.html', 'utf8');
const works = await readFile('my-novels.html', 'utf8');
const replay = await readFile('scripts/run-migration-replay.sh', 'utf8');

test('B #16 stores only a token hash and leaves normal publication status untouched', () => {
  assert.match(migration, /create table public\.novel_share_links/iu);
  assert.match(migration, /token_hash bytea not null unique/iu);
  assert.doesNotMatch(migration, /\btoken\s+text\b/iu);
  assert.match(migration, /n\.status = 'draft'/u);
  assert.doesNotMatch(
    migration,
    /update public\.novels[\s\S]*set\s+status\s*=\s*'published'/iu
  );
});

test('share token is high entropy, hashed, and rotated atomically', () => {
  assert.match(migration, /gen_random_uuid\(\)[\s\S]*gen_random_uuid\(\)/iu);
  assert.match(
    migration,
    /sha256\(pg_catalog\.convert_to\(v_token, 'UTF8'\)\)/u
  );
  assert.match(
    migration,
    /on conflict \(novel_id\) do update[\s\S]*token_hash = excluded\.token_hash/iu
  );
});

test('public reader RPCs are token-bound and remain draft-only', () => {
  assert.match(
    migration,
    /create or replace function public\.novelight_shared_novel\([\s\S]*n\.status = 'draft'/iu
  );
  assert.match(
    migration,
    /create or replace function public\.novelight_shared_episode\([\s\S]*n\.status = 'draft'/iu
  );
  assert.match(
    migration,
    /grant execute on function public\.novelight_shared_novel\(text\)[\s\S]*to anon, authenticated/iu
  );
  assert.match(
    migration,
    /grant execute on function public\.novelight_shared_episode\(text, bigint\)[\s\S]*to anon, authenticated/iu
  );
});

test('owner controls are authenticated-only and raw secret table is not client-readable', () => {
  for (const signature of [
    'novelight_share_link_status\\(bigint\\)',
    'novelight_rotate_share_link\\(bigint\\)',
    'novelight_revoke_share_link\\(bigint\\)'
  ]) {
    assert.match(
      migration,
      new RegExp(
        `grant execute on function public\\.${signature}[\\s\\S]*?to authenticated`,
        'iu'
      )
    );
  }
  assert.match(
    migration,
    /revoke all on table public\.novel_share_links from public, anon, authenticated/iu
  );
});

test('publishing or transferring a work revokes limited sharing', () => {
  assert.match(
    migration,
    /create trigger novelight_revoke_share_link_when_public[\s\S]*after update of status, user_id on public\.novels/iu
  );
  assert.match(
    migration,
    /new\.status <> 'draft'[\s\S]*delete from public\.novel_share_links/iu
  );
});

test('shared UI keeps the secret in the URL fragment and never starts normal engagement tracking', () => {
  assert.match(
    runtime,
    /url\.hash = new URLSearchParams\(\{ token: normalized \}\)/u
  );
  assert.match(reader, /location\.hash\.slice\(1\)/u);
  assert.match(reader, /<meta name="referrer" content="no-referrer">/u);
  assert.doesNotMatch(reader, /location\.search[\s\S]*token/iu);
  assert.doesNotMatch(
    reader + runtime,
    /recordVisit|increment.*pv|favorite|send_light_seed|post_novel_comment/iu
  );
  assert.match(reader, /novelight-prose\.js/u);
  assert.match(runtime, /NovelightProse\?\.renderInto/u);
});

test('author UI links to limited sharing and warns that all current episode bodies are exposed', () => {
  assert.match(works, /share-link\.html\?novel_id=/u);
  assert.match(manager, /限定共有リンク/u);
  assert.match(runtime, /全エピソード本文を閲覧できます/u);
  assert.match(runtime, /再発行すると以前のURLは無効/u);
});

test('migration has fail-closed precheck, postcheck, rollback, and replay coverage', () => {
  assert.match(
    precheck,
    /PRECHECK PASS: B #16 draft-only limited sharing prerequisites are ready/u
  );
  assert.match(
    postcheck,
    /POSTCHECK PASS: B #16 sharing is draft-only, token-bound, and evaluation-neutral/u
  );
  assert.match(rollback, /ROLLBACK REFUSED: active limited-share links exist/u);
  assert.match(
    replay,
    /Verify B #16 limited share links[\s\S]*20260918225815_limited_share_links_rollback\.sql[\s\S]*20260918225815_limited_share_links\.sql/iu
  );
});

test('shared reader payload intentionally omits evaluation and exposure state', () => {
  assert.match(
    migration,
    /Returns no raw secret, IDs, PV, Rank, SCOUT, favorites, or exposure state/iu
  );
  assert.doesNotMatch(
    migration,
    /record_trusted|recalculate_work_rank|send_light_seed|novel_exposure_events|insert into public\.favorites/iu
  );
});
