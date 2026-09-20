import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (file) => readFile(file, 'utf8');
const version = '20260920093847';

const [
  migration,
  precheck,
  postcheck,
  rollback,
  api,
  browser,
  css,
  episode,
  edit,
  post,
  prose,
  exportClient,
  myNovels,
  replay,
  restore,
  master
] = await Promise.all([
  read(`supabase/migrations/${version}_episode_inline_illustrations.sql`),
  read(`supabase/checks/${version}_episode_inline_illustrations_precheck.sql`),
  read(`supabase/checks/${version}_episode_inline_illustrations_postcheck.sql`),
  read(
    `supabase/rollback/${version}_episode_inline_illustrations_rollback.sql`
  ),
  read('api/_lib/episode-illustrations.js'),
  read('novelight-episode-illustrations.js'),
  read('novelight-episode-illustrations.css'),
  read('episode.html'),
  read('episode-edit.html'),
  read('episode-post.html'),
  read('novelight-prose.js'),
  read('novelight-author-work-export.js'),
  read('my-novels.html'),
  read('scripts/run-migration-replay.sh'),
  read('supabase/checks/restore_validation.sql'),
  read('docs/NOVELIGHT-MASTER.md')
]);

test('MASTER locks safe plain-text illustration blocks and beta media limits', () => {
  assert.match(master, /episodes\.content[\s\S]{0,500}illustration ID/iu);
  assert.match(master, /HTML[\s\S]{0,300}script[\s\S]{0,300}iframe/iu);
  assert.match(master, /JPEG[\s\S]{0,80}PNG[\s\S]{0,80}WebP/iu);
  assert.match(master, /SVG[\s\S]{0,80}GIF/iu);
  assert.match(master, /10MB/iu);
  assert.match(master, /10枚/u);
  assert.match(master, /4096px/iu);
  assert.match(master, /2000px/iu);
  assert.match(master, /Storage/iu);
  assert.match(master, /Storage URL/iu);
});

test('database stores private stable assets and service-only bounded RPCs', () => {
  assert.match(migration, /create table public\.episode_illustrations/iu);
  assert.match(migration, /illustration_ai_usage boolean/iu);
  assert.match(
    migration,
    /create table public\.episode_illustration_upload_audit/iu
  );
  assert.match(migration, /novelight_authorize_episode_illustration_upload/iu);
  assert.match(migration, /EPISODE_ILLUSTRATION_UPLOAD_RATE_LIMITED/u);
  assert.match(migration, /interval '10 minutes'/iu);
  assert.match(migration, />= 20/iu);
  assert.match(migration, /interval '24 hours'/iu);
  assert.match(migration, />= 100/iu);
  assert.match(
    migration,
    /alter table public\.episode_illustrations enable row level security/iu
  );
  assert.match(
    migration,
    /revoke all on table public\.episode_illustrations[\s\S]*authenticated[\s\S]*service_role/iu
  );
  assert.match(migration, /v_count >= 10/iu);
  assert.match(migration, /p_width > 2000/iu);
  assert.match(migration, /p_height > 2000/iu);
  assert.match(migration, /p_file_size > 10485760/iu);
  assert.match(migration, /v_episode\.illustration_ai_usage is null/iu);
  assert.match(migration, /novelight_collaboration_can_edit/iu);
  assert.match(migration, /v_episode\.owner_user_id = p_actor_user_id/iu);
  assert.match(
    migration,
    /grant execute on function public\.novelight_register_episode_illustration[\s\S]*to service_role/iu
  );
  assert.doesNotMatch(
    migration,
    /grant execute on function public\.novelight_register_episode_illustration[\s\S]*to authenticated/iu
  );
});

test('dedicated Storage bucket is private and receives optimized WebP only', () => {
  assert.match(migration, /'episode-illustrations'/u);
  assert.match(
    migration,
    /'episode-illustrations',[\s\S]*false,[\s\S]*10485760,[\s\S]*array\['image\/webp'\]/iu
  );
  assert.match(api, /novelight_authorize_episode_illustration_upload/u);
  assert.match(api, /status: 429/u);
  assert.match(api, /createSignedUploadUrl/u);
  assert.match(api, /createSignedUrl/u);
  assert.match(api, /download\(path\)/u);
  assert.match(api, /webpDimensions/u);
  assert.doesNotMatch(api, /getPublicUrl/u);
  assert.doesNotMatch(browser, /image\/svg\+xml|image\/gif/iu);
  assert.match(browser, /image\/jpeg/iu);
  assert.match(browser, /image\/png/iu);
  assert.match(browser, /image\/webp/iu);
  assert.match(browser, /INPUT_MAX_EDGE = 4096/u);
  assert.match(browser, /DELIVERY_MAX_EDGE = 2000/u);
  assert.match(browser, /canvas\.toBlob[\s\S]*image\/webp/iu);
});

test('reader only uses exact NOVELIGHT markers and no arbitrary HTML or external image URL syntax', () => {
  assert.match(browser, /NOVELIGHT_ILLUSTRATION:/u);
  assert.match(browser, /const MARKER_LINE/u);
  assert.match(api, /referencedIds\(bundle\.content\)/u);
  assert.match(api, /ids\.has\(String\(asset\.id\)\.toLowerCase\(\)\)/u);
  assert.match(browser, /createElement\('figure'\)/u);
  assert.match(browser, /createElement\('img'\)/u);
  assert.doesNotMatch(browser, /innerHTML\s*=\s*.*asset\.url/iu);
  assert.doesNotMatch(browser, /<iframe|setAttribute\(['"]onerror['"]/iu);
  assert.match(css, /\.episode-inline-illustration img/u);
});

test('warning gate runs before reader illustration signing and report copy covers illustrations', () => {
  assert.match(
    episode,
    /if\(!isAuthor&&novelNeedsGate\(\)&&!warningAccepted\(\)\)\{showGate\(\);return\}await loadEpisodeContentAndRender\(\)/u
  );
  assert.match(
    episode,
    /NovelightEpisodeIllustrations\.mountReader\(\{root:document\.querySelector\('\.content'\),episodeId:episode\.id,content:episode\.content\}\)/u
  );
  assert.match(episode, /本文・挿絵の著作権侵害/u);
});

test('author editor supports owner and collaborator placement without widening collaborator powers', () => {
  assert.match(edit, /novelight-episode-illustrations\.js/u);
  assert.match(edit, /id="episodeIllustrationsMount"/u);
  assert.match(edit, /NovelightEpisodeIllustrations\.mountEditor/u);
  assert.match(edit, /isOwner:!collaborationEditor/u);
  assert.match(browser, /カーソル位置へ挿入/u);
  assert.match(browser, /本文から外す場合は挿絵IDの行を削除/u);
  assert.match(browser, /過去の改稿履歴を壊さない/u);
  assert.match(post, /一度「サーバーに下書き保存」した後/u);
});

test('AI illustration declaration and detailed upload rules match Chapter 46', () => {
  const exactWarning =
    'AI生成画像も使用できます。権利侵害・無断転載・誹謗中傷・禁止される成人向け表現・政治家等について事実と誤認させる画像は禁止です。挿絵は投稿ガイドライン・通報・ゾーニングの対象です。';
  assert.ok(browser.includes(exactWarning));
  assert.match(browser, /挿絵のAI利用申告/u);
  assert.match(browser, /本文のAI利用区分とは別/u);
  assert.match(browser, /権利侵害/u);
  assert.match(browser, /成人向け/u);
  assert.match(browser, /政治・選挙・政治家/u);
  assert.match(browser, /自動最適化/u);
  assert.match(migration, /n\.user_id = p_actor_user_id/iu);
});

test('prose and TTS composition keeps illustrations out of forced speech', () => {
  assert.match(prose, /nl-episode-prose-text/u);
  assert.match(
    prose,
    /novelightIllustrationsRendered|novelight-illustrations-rendered/u
  );
  assert.match(browser, /global\.NovelightProse\?\.renderInto/iu);
  assert.doesNotMatch(browser, /figcaption/u);
  assert.doesNotMatch(browser, /speechSynthesis|SpeechSynthesisUtterance/u);
});

test('illustration-aware work backups preserve marker positions, manifest metadata, and WebP binaries', () => {
  assert.match(myNovels, /novelight-zip\.js/u);
  assert.match(myNovels, /作品バックアップ/u);
  assert.match(exportClient, /export-bundle/u);
  assert.match(exportClient, /illustrations\/manifest\.json/u);
  assert.match(
    exportClient,
    /illustrations\/\$\{asset\.episodeId\}\/\$\{asset\.id\}\.webp/u
  );
  assert.match(exportClient, /work\.txt/u);
  assert.match(exportClient, /NOVELIGHT_ILLUSTRATION:<id>/u);
  assert.match(exportClient, /p_format: format/u);
  assert.match(migration, /format in \('txt','zip'\)/iu);
  assert.match(rollback, /format = 'txt'/iu);
  assert.match(
    rollback,
    /ZIP backup audit records depend on illustration export support/u
  );
});

test('feature stays outside Rank, LIGHT SEED, SCOUT, PV, favorites, and exposure', () => {
  const relevant =
    migration.match(
      /create or replace function public\.novelight_register_episode_illustration[\s\S]*?\$\$;/
    )?.[0] || '';
  assert.ok(relevant);
  assert.doesNotMatch(
    relevant,
    /light_seed|scout|work_rank|rank_state|novel_exposure|record_episode_pv|favorites|update public\.novels[\s\S]*\bpv\b/iu
  );
  assert.match(postcheck, /evaluation-neutral/u);
  assert.match(
    master,
    /Rank[\s\S]{0,300}LIGHT SEED[\s\S]{0,300}SCOUT[\s\S]{0,300}PV/iu
  );
});

test('migration has guarded safety artifacts, replay, and restore coverage', () => {
  assert.match(precheck, /Episode illustration prerequisites are missing/u);
  assert.match(postcheck, /raw illustration table privileges leaked/u);
  assert.match(
    rollback,
    /Rollback blocked: episode illustration asset registry contains user data/u
  );
  assert.match(rollback, /private Storage bucket is intentionally preserved/u);
  assert.match(
    replay,
    /Verify episode inline illustrations behavior[\s\S]*tests\/rls\/episode-inline-illustrations\.sql/iu
  );
  assert.match(
    replay,
    /Verify episode inline illustrations rollback and reapply[\s\S]*20260920093847_episode_inline_illustrations_rollback\.sql/iu
  );
  assert.match(restore, /'episode_illustrations'/u);
  assert.match(restore, /'episode_illustration_upload_audit'/u);
  assert.match(restore, /'novelight_authorize_episode_illustration_upload'/u);
  assert.match(restore, /'novelight_episode_illustration_editor_bundle'/u);
  assert.match(restore, /'novelight_public_episode_illustration_bundle'/u);
  assert.match(restore, /'novelight_owner_illustration_export_bundle'/u);
});
