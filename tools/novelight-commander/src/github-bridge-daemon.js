// Keep the established NOVELIGHT Bridge and X read loop in one supervised Node process.
// `bridge_update` exits this process with code 75, so the existing PowerShell supervisor
// restarts all loops together without depending on a parent-process restart.
import './github-bridge-core.js';
import './x-bridge-daemon.js';
import './scout-badge-live-bridge.js';
import './master-project-sync-bridge.js';
import './master-auto-sync-daemon.js';
import './master-auto-sync-status-bridge.js';
import './master-profile-repair-bridge-v2.js';
import './author-badge-pack-probe-bridge.js';
import './author-badge-production-reconcile-bridge.js';
import './author-badge-register22-v2-bridge.js';
import './author-badge-register13-bridge.js';
import './hard-badge-register25-bridge.js';
import { mainProductionMigrationApproveBridge } from './production-migration-approve-bridge.js';

void mainProductionMigrationApproveBridge().catch(error => {
  console.error('[NLO production migration approval bridge] fatal:', error);
  process.exitCode = 1;
});
