import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { request } from '@playwright/test';

const statePath =
  process.env.VERCEL_BYPASS_STORAGE_STATE ||
  '/tmp/novelight-vercel-bypass-storage-state.json';

async function writeEmptyState() {
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(
    statePath,
    JSON.stringify({ cookies: [], origins: [] }, null, 2),
    { mode: 0o600 }
  );
}

export default async function globalSetup() {
  const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (!secret) {
    await writeEmptyState();
    return;
  }

  const baseURL = process.env.E2E_BASE_URL;
  if (!baseURL) {
    throw new Error(
      'E2E_BASE_URL is required when VERCEL_AUTOMATION_BYPASS_SECRET is configured.'
    );
  }

  const target = new globalThis.URL(baseURL);
  if (target.protocol !== 'https:') {
    throw new Error('Vercel bypass setup requires an HTTPS target.');
  }

  await mkdir(dirname(statePath), { recursive: true });
  const context = await request.newContext({ baseURL: target.origin });

  try {
    const response = await context.get('/login.html', {
      headers: {
        'x-vercel-protection-bypass': secret,
        'x-vercel-set-bypass-cookie': 'true'
      }
    });

    if (!response.ok()) {
      throw new Error(
        `Vercel bypass bootstrap failed with HTTP ${response.status()}.`
      );
    }

    const state = await context.storageState({ path: statePath });
    const hasScopedCookie = state.cookies.some(
      (cookie) =>
        cookie.domain === target.hostname ||
        cookie.domain === `.${target.hostname}`
    );

    if (!hasScopedCookie) {
      throw new Error('Vercel bypass bootstrap did not create a host-scoped cookie.');
    }
  } finally {
    await context.dispose();
  }
}
