import { readFile } from 'node:fs/promises';
import { synchronizeDrafts } from '../../../scripts/novelight-pr-auto-sync.mjs';

const OWNER = 'bingohooah888-ai';
const REPOSITORY = OWNER + '/novelrise';
const INTERVAL_MS = 15 * 60 * 1000;
const REGISTRY = new URL('../../../.novelight/nlo-capabilities.json', import.meta.url);
let busy = false;

async function isEnabled() {
  const data = JSON.parse(await readFile(REGISTRY, 'utf8'));
  const capability = data.capabilities?.find(
    (item) => item.id === 'nlo.github.owner-draft-pr-sync'
  );
  return capability?.status === 'enabled';
}

export async function runOwnerDraftSyncOnce({
  token,
  fetchImpl = fetch,
  nowMs = Date.now(),
  log = () => {}
}) {
  if (!token) throw new Error('Existing NLO owner GitHub credential is required');
  const identity = await fetchImpl('https://api.github.com/user', {
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json'
    }
  });
  if (!identity.ok || (await identity.json()).login !== OWNER) {
    throw new Error('NLO GitHub credential is not the repository owner');
  }
  return synchronizeDrafts({
    repository: REPOSITORY,
    event: 'nlo_poll',
    readToken: token,
    writeToken: token,
    fetchImpl,
    nowMs,
    log
  });
}

export async function mainOwnerDraftAutoSync() {
  async function tick() {
    if (busy) return;
    busy = true;
    try {
      if (!(await isEnabled())) return;
      const outcome = await runOwnerDraftSyncOnce({
        token: process.env.NOVELIGHT_BRIDGE_GITHUB_TOKEN,
        log: (message) => console.log('[NLO Draft PR sync] ' + message)
      });
      if (outcome.updated.length || outcome.deferred.length) {
        console.log('[NLO Draft PR sync] ' + JSON.stringify(outcome));
      }
    } catch (error) {
      console.error(
        '[NLO Draft PR sync] safe stop:',
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      busy = false;
    }
  }
  void tick();
  const timer = setInterval(() => void tick(), INTERVAL_MS);
  timer.unref?.();
}
