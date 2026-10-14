import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { withMasterProjectSyncLock } from './master-project-sync-lock.js';
import { observeProjectPageLoad } from './master-project-render-telemetry.js';

export const HEADFUL_DIAGNOSTIC_CONFIRMATION =
  'RUN_NLO_MASTER_HEADFUL_READONLY_DIAGNOSTIC';

export function validatedMasterProjectUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.origin !== 'https://chatgpt.com') return null;
    if (url.search || url.hash) return null;
    if (!/^\/g\/g-p-[a-zA-Z0-9_-]+\/project\/?$/.test(url.pathname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function safeErrorCategory(error) {
  const name = String(error?.name || '');
  // Do not expose Playwright's diagnostic exception, URLs, cookies,
  // authentication state, or page data in a public GitHub issue comment.
  return ['TimeoutError', 'TargetClosedError'].includes(name) ? name : 'Error';
}

function browserLibrary(repoRoot) {
  const packagePath = path.join(repoRoot, 'tests', 'e2e', 'package.json');
  try {
    return createRequire(packagePath)('@playwright/test').chromium;
  } catch {
    return null;
  }
}

export async function diagnoseMasterHeadfulReadOnly(config) {
  const { repoRoot, dataRoot } = config;
  if (!repoRoot || !dataRoot) return { status: 'SAFE_STOP_CONFIG_MISSING' };
  const statePath = path.join(dataRoot, 'master-sync', 'AUTO-SYNC.json');
  let state;
  try {
    state = JSON.parse(String(await fs.readFile(statePath, 'utf8')).replace(/^\uFEFF/u, ''));
  } catch {
    return { status: 'SAFE_STOP_NO_VALID_SYNC_STATE' };
  }
  const url = validatedMasterProjectUrl(state.projectUrl);
  if (!url || state.projectName !== 'NOVELIGHT') {
    return { status: 'SAFE_STOP_PROJECT_IDENTITY_UNVERIFIED' };
  }
  const profile = path.join(dataRoot, 'chatgpt-browser-profile');
  try {
    if (!(await fs.stat(profile)).isDirectory()) {
      return { status: 'SAFE_STOP_PROFILE_MISSING' };
    }
  } catch {
    return { status: 'SAFE_STOP_PROFILE_MISSING' };
  }
  const chromium = browserLibrary(repoRoot);
  if (!chromium) return { status: 'SAFE_STOP_PLAYWRIGHT_UNAVAILABLE' };

  // The production background MASTER loop uses this same lock. The probe
  // NEVER calls the MASTER sync function or clicks/upload/deletes anything.
  const locked = await withMasterProjectSyncLock(dataRoot, async () => {
    let context;
    let stage = 'launch';
    try {
      context = await chromium.launchPersistentContext(profile, {
        channel: 'chrome',
        headless: false,
        viewport: null,
        args: ['--no-first-run', '--no-default-browser-check']
      });
      const page = await context.newPage();
      const counts = observeProjectPageLoad(page);
      stage = 'navigate';
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page
        .waitForFunction(
          () => Boolean(document.querySelector('main')?.innerText?.trim()),
          null,
          { timeout: 12000 }
        )
        .catch(() => {});
      stage = 'inspect';
      const dom = await page.evaluate(() => {
        const visible = node => Boolean(node?.getClientRects().length);
        const norm = value => String(value || '').replace(/\s+/g, ' ').trim();
        const main = document.querySelector('main');
        const exactBodyLine = String(document.body?.innerText || '')
          .split(/\r?\n/)
          .some(line => norm(line) === 'NOVELIGHT');
        const heading = [...document.querySelectorAll('main h1, main h2')].some(
          el => visible(el) && norm(el.innerText) === 'NOVELIGHT'
        );
        return {
          documentComplete: document.readyState === 'complete',
          hasMain: Boolean(main),
          bodyEmpty: !norm(document.body?.innerText),
          mainEmpty: !norm(main?.innerText),
          projectNameVisibleInBody: exactBodyLine,
          projectNameInMainHeading: heading
        };
      });
      const opened = validatedMasterProjectUrl(page.url());
      return {
        status: 'READ_ONLY_COMPLETED',
        projectRouteMatches: opened === url,
        ...dom,
        ...counts,
        mutationPerformed: false
      };
    } catch (error) {
      return {
        status: 'SAFE_STOP_DIAGNOSTIC_FAILED',
        failedStage: stage,
        errorCategory: safeErrorCategory(error),
        mutationPerformed: false
      };
    } finally {
      if (context) await context.close().catch(() => {});
    }
  });

  return locked.skipped
    ? { status: 'SAFE_STOP_MASTER_SYNC_BUSY', mutationPerformed: false }
    : locked.value;
}
