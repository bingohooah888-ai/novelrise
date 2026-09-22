import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const commander = path.resolve(here, '../tools/novelight-commander');
const sourceFiles = [
  'src/index.js',
  'src/security.js',
  'src/novel.js',
  'src/novel-cache.js',
  'src/files.js',
  'src/processes.js',
  'src/archive.js',
  'src/audit.js',
  'src/binary-transfer.js',
  'src/thumbnail-register.js',
  'src/assets.js'
];

test('NOVELIGHT Commander source is syntactically valid', () => {
  for (const relative of sourceFiles) {
    const file = path.join(commander, relative);
    const args = ['--check', file];
    const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.equal(result.status, 0, relative + '\n' + result.stderr);
  }
});

test('NOVELIGHT Commander defaults fail closed', async () => {
  const securityFile = path.join(commander, 'src/security.js');
  const securityUrl = pathToFileURL(securityFile).href;
  const security = await import(securityUrl);
  const env = { NOVELIGHT_COMMANDER_ROOT: commander };
  const config = security.createSecurityConfig(env);
  const pushArgs = ['push', 'origin', 'main'];
  const invoke = () => security.assertSafeInvocation('git', pushArgs, config);

  assert.equal(config.allowShell, false);
  assert.equal(config.allowDestructive, false);
  assert.equal(config.allowProduction, false);
  assert.equal(config.commands.has('powershell'), false);
  assert.equal(config.commands.has('node'), false);
  assert.throws(invoke, /production mode/i);
});

test('Commander package carries required dependencies', async () => {
  const packageFile = path.join(commander, 'package.json');
  const packageText = await readFile(packageFile, 'utf8');
  const pkg = JSON.parse(packageText);
  const dependencies = [
    '@modelcontextprotocol/sdk',
    '@supabase/supabase-js',
    'cheerio',
    'dotenv',
    'jszip',
    'pngjs',
    'zod'
  ];

  assert.equal(pkg.version, '0.5.0');
  for (const dependency of dependencies) {
    assert.ok(pkg.dependencies[dependency], dependency);
  }

  const envFile = path.join(commander, '.env.example');
  const env = await readFile(envFile, 'utf8');
  assert.match(env, /NOVELIGHT_COMMANDER_ALLOW_SHELL=false/);
  assert.match(env, /NOVELIGHT_COMMANDER_ALLOW_DESTRUCTIVE=false/);
  assert.match(env, /NOVELIGHT_COMMANDER_ALLOW_PRODUCTION=false/);
});

test('Commander exposes the NOVELIGHT operations surface', async () => {
  const indexFile = path.join(commander, 'src/index.js');
  const source = await readFile(indexFile, 'utf8');
  const names = [
    'novelight_preflight',
    'novelight_doctor',
    'git_latest_main',
    'git_worktree_add',
    'begin_binary_write',
    'validate_thumbnail_pack',
    'inspect_png',
    'read_novel_cached',
    'start_process',
    'gh_pr_checks',
    'supabase_migration_list',
    'vercel_list',
    'register_official_thumbnail_pack',
    'validate_thumbnail_asset',
    'scan_thumbnail_directory',
    'build_thumbnail_pack',
    'composite_png_layers',
    'novelight_context_bundle',
    'novelight_handoff_report'
  ];

  for (const name of names) {
    const marker = 'register("' + name + '"';
    assert.ok(source.includes(marker), name);
  }
});

test('NLO bridge can verify a saved novel without refetching it', async () => {
  const bridgeFile = path.join(commander, 'src/github-bridge-daemon.js');
  const source = await readFile(bridgeFile, 'utf8');

  assert.match(source, /novel_verify_saved/);
  assert.match(source, /actionNovelVerifySaved/);
  assert.match(source, /missingBodyEpisodes/);
  assert.match(source, /uniqueEpisodeUrls/);
  assert.match(source, /sequenceComplete/);
  assert.match(source, /storedNumberingContiguous/);
  assert.match(source, /verified: /);
});

test('NLO novel reader recognizes public Caita episode URLs', async () => {
  const novelFile = path.join(commander, 'src/novel.js');
  const source = await readFile(novelFile, 'utf8');

  assert.match(source, /host === "caita\.ai"/);
  assert.match(source, /host\.endsWith\("\.caita\.ai"\)/);
  assert.match(source, /return "caita"/);
  assert.match(source, /\/viewer\/episode\//);
  assert.match(source, /--headless=new/);
  assert.match(source, /--dump-dom/);
  assert.match(source, /dumpDomWithBrowser/);
  assert.match(source, /--remote-debugging-address=127\.0\.0\.1/);
  assert.match(source, /--remote-debugging-port=/);
  assert.match(source, /dumpDomWithVisibleBrowser/);
  assert.match(source, /readCaitaNovel/);
  assert.match(source, /nextEpisodeUrl/);
  assert.match(source, /currentEpisodeHint \+ 1/);
  assert.match(source, /navigationReady/);
  assert.match(source, /parsed\.nextEpisodeUrl/);
  assert.match(source, /openVisibleBrowserSession/);
  assert.match(source, /navigateVisibleBrowserSession/);
  assert.match(source, /closeVisibleBrowserSession/);
  assert.match(source, /pageTextWithNavigation/);
  assert.match(source, /progressMatch = pageTextWithNavigation\.match/);
  assert.match(source, /endedNaturally/);
  assert.match(source, /reachedNaturalSeriesEnd/);
  assert.match(source, /contiguousFromFirst/);
  assert.match(source, /currentNumber \+ 1/);
  assert.doesNotMatch(source, /currentIndex \+ 1 < linkedEpisodes\.length/);
});
