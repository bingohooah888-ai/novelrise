import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';

const OWNER = 'bingohooah888-ai';
const REPOSITORY = 'novelrise';
const ISSUE_NUMBER = 797;
const REQUEST_PREFIX = 'NOVELIGHT_AUTHOR_BADGE_RECONCILE_REQUEST ';
const RESULT_PREFIX = 'NOVELIGHT_AUTHOR_BADGE_RECONCILE_RESULT_V1';
const REQUEST_ID_RE = /^cmdr-[0-9]{8}T[0-9]{6}Z-[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;
const PRODUCTION_BASE = 'https://novelrise.vercel.app/';

const EASY = [
  ['Author_Easy_001.png', 'author_novel_001'],
  ['Author_Easy_002.png', 'author_episode_001'],
  ['Author_Easy_003.png', 'author_reader_001'],
  ['Author_Easy_004.png', 'author_favorite_001'],
  ['Author_Easy_005.png', 'author_comment_001']
];
const NORMAL = [
  ['Author_Normal_001.png', 'author_episode_010'],
  ['Author_Normal_002.png', 'author_episode_025'],
  ['Author_Normal_003.png', 'author_episode_050'],
  ['Author_Normal_004.png', 'author_episode_100'],
  ['Author_Normal_005.png', 'author_episode_250'],
  ['Author_Normal_006.png', 'author_chars_010k'],
  ['Author_Normal_007.png', 'author_chars_050k'],
  ['Author_Normal_008.png', 'author_chars_100k'],
  ['Author_Normal_009.png', 'author_chars_250k'],
  ['Author_Normal_010.png', 'author_chars_500k'],
  ['Author_Normal_011.png', 'author_completed_001'],
  ['Author_Normal_012.png', 'author_completed_003'],
  ['Author_Normal_013.png', 'author_completed_005'],
  ['Author_Normal_014.png', 'author_novel_002'],
  ['Author_Normal_015.png', 'author_novel_005'],
  ['Author_Normal_016.png', 'author_novel_010'],
  ['Author_Normal_017.png', 'author_unique_reader_010'],
  ['Author_Normal_018.png', 'author_unique_reader_050'],
  ['Author_Normal_019.png', 'author_unique_reader_100'],
  ['Author_Normal_020.png', 'author_unique_reader_500'],
  ['Author_Normal_021.png', 'author_favorite_010'],
  ['Author_Normal_022.png', 'author_favorite_050'],
  ['Author_Normal_023.png', 'author_favorite_100'],
  ['Author_Normal_024.png', 'author_comment_010'],
  ['Author_Normal_025.png', 'author_comment_050'],
  ['Author_Normal_026.png', 'author_seed_received_001'],
  ['Author_Normal_027.png', 'author_seed_received_010'],
  ['Author_Normal_028.png', 'author_seed_received_050'],
  ['Author_Normal_029.png', 'author_discovered_plus2_001'],
  ['Author_Normal_030.png', 'author_discovered_plus3_001']
];

function token() {
  return String(process.env.NOVELIGHT_BRIDGE_GITHUB_TOKEN || '').trim();
}
async function githubApi(method, apiPath, body) {
  const auth = token();
  if (!auth) return null;
  const response = await fetch('https://api.github.com' + apiPath, {
    method,
    headers: {
      Authorization: 'Bearer ' + auth,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'NOVELIGHT-Commander-Author-Badge-Reconcile'
    },
    body: body == null ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000)
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${payload?.message || response.statusText}`);
  return payload;
}
function parseRequest(comment) {
  if (comment?.user?.login !== OWNER || comment?.author_association !== 'OWNER') return null;
  const body = String(comment.body || '');
  if (!body.startsWith(REQUEST_PREFIX)) return null;
  const request = JSON.parse(body.slice(REQUEST_PREFIX.length));
  if (
    Object.keys(request).sort().join(',') !== 'action,args,requestId,version' ||
    request.version !== 1 || request.action !== 'author_badge_reconcile' ||
    !REQUEST_ID_RE.test(String(request.requestId || '')) || !request.args ||
    Array.isArray(request.args) || Object.keys(request.args).length !== 0
  ) throw new Error('Author badge reconcile request does not match the fixed read-only contract.');
  return request;
}
async function readPack(fileName, mapping) {
  const filePath = path.join(os.homedir(), 'Downloads', fileName);
  const bytes = await fs.readFile(filePath);
  const zip = await JSZip.loadAsync(bytes);
  const rows = [];
  for (const [entryName, badgeId] of mapping) {
    const entry = zip.file(entryName);
    if (!entry) throw new Error(`Missing ${entryName} in ${fileName}`);
    const image = await entry.async('nodebuffer');
    rows.push({
      fileName: entryName,
      badgeId,
      sourceSize: image.length,
      sourceSha256: createHash('sha256').update(image).digest('hex')
    });
  }
  return rows;
}
function extractArtworkPath(scriptText, badgeId) {
  const escaped = badgeId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = scriptText.match(new RegExp(`(?:^|\\n)\\s*${escaped}:\\s*['\"]([^'\"]+)['\"]`));
  return match?.[1] || null;
}
async function fetchBytes(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(20000), redirect: 'follow' });
    if (!response.ok) return { status: response.status, bytes: null };
    return { status: response.status, bytes: Buffer.from(await response.arrayBuffer()) };
  } catch (error) {
    return { status: 0, bytes: null, error: error instanceof Error ? error.message : String(error) };
  }
}
async function reconcile() {
  const sourceRows = [
    ...(await readPack('NOVELIGHT_Author_Easy_5_images.zip', EASY)),
    ...(await readPack('NOVELIGHT_Author_Normal_30_images.zip', NORMAL))
  ];
  const scriptResponse = await fetch(PRODUCTION_BASE + 'novelight-scout-record.js', {
    signal: AbortSignal.timeout(20000),
    redirect: 'follow'
  });
  if (!scriptResponse.ok) throw new Error(`Production scout script HTTP ${scriptResponse.status}`);
  const scriptText = await scriptResponse.text();
  const rows = [];
  for (const source of sourceRows) {
    const artworkPath = extractArtworkPath(scriptText, source.badgeId);
    if (!artworkPath) {
      rows.push({ ...source, state: 'unregistered_mapping', artworkPath: null, httpStatus: null, productionSha256: null });
      continue;
    }
    const assetUrl = new URL(artworkPath, PRODUCTION_BASE).href;
    const fetched = await fetchBytes(assetUrl);
    const productionSha256 = fetched.bytes
      ? createHash('sha256').update(fetched.bytes).digest('hex')
      : null;
    const state = fetched.status !== 200
      ? 'mapped_asset_missing'
      : productionSha256 === source.sourceSha256
        ? 'registered_exact'
        : 'registered_hash_mismatch';
    rows.push({ ...source, state, artworkPath, httpStatus: fetched.status, productionSha256 });
  }
  const registeredExact = rows.filter(row => row.state === 'registered_exact');
  const missing = rows.filter(row => row.state !== 'registered_exact');
  return {
    nloRoute: 'github_bridge',
    remoteDesktopCommanderDependency: false,
    productionBase: PRODUCTION_BASE,
    total: rows.length,
    registeredExactCount: registeredExact.length,
    missingOrMismatchCount: missing.length,
    registeredExact: registeredExact.map(row => ({ badgeId: row.badgeId, fileName: row.fileName, artworkPath: row.artworkPath, sha256: row.sourceSha256 })),
    missingOrMismatch: missing.map(row => ({ badgeId: row.badgeId, fileName: row.fileName, state: row.state, artworkPath: row.artworkPath, httpStatus: row.httpStatus, sourceSha256: row.sourceSha256, productionSha256: row.productionSha256 }))
  };
}
async function postResult(request, status, details) {
  const body = [
    RESULT_PREFIX, '',
    `- request_id: \`${request.requestId}\``,
    '- action: `author_badge_reconcile`',
    `- status: **${status}**`,
    `- observed_at: \`${new Date().toISOString()}\``, '',
    '~~~json',
    typeof details === 'string' ? details : JSON.stringify(details, null, 2),
    '~~~'
  ].join('\n');
  await githubApi('POST', `/repos/${OWNER}/${REPOSITORY}/issues/${ISSUE_NUMBER}/comments`, { body });
}
async function processPendingRequest() {
  if (!token()) return;
  const since = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const comments = await githubApi('GET', `/repos/${OWNER}/${REPOSITORY}/issues/${ISSUE_NUMBER}/comments?per_page=100&since=${encodeURIComponent(since)}`);
  const requests = [];
  for (const comment of comments || []) {
    try {
      const request = parseRequest(comment);
      if (request) requests.push({ request, commentId: Number(comment.id) });
    } catch (error) {
      console.error('[NLO author-badge-reconcile] invalid request:', error instanceof Error ? error.message : String(error));
    }
  }
  if (!requests.length) return;
  requests.sort((a, b) => a.commentId - b.commentId);
  const target = requests.at(-1).request;
  const completed = (comments || []).some(comment => String(comment.body || '').startsWith(RESULT_PREFIX) && String(comment.body || '').includes(`- request_id: \`${target.requestId}\``));
  if (completed) return;
  try { await postResult(target, 'success', await reconcile()); }
  catch (error) { await postResult(target, 'failure', error instanceof Error ? error.stack || error.message : String(error)); }
}
void processPendingRequest().catch(error => console.error('[NLO author-badge-reconcile] startup failed:', error));
