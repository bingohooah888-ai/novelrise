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
import './special-badge-asset-probe-bridge.js';
import './special-badge-exact-probe-bridge.js';
import './special-badge-register-bridge.js';
import './public-header-logo-bridge.js';
import './public-header-logo-special-bridge.js';
import './public-header-logo-asset-bridge.js';
import './scout-lock-artwork-bridge.js';
import './scout-lock-artwork-final-bridge.js';
import './scout-lock-local-cache-bridge.js';
import './scout-lock-direct-register-bridge.js';
import { mainProductionMigrationApproveBridge } from './production-migration-approve-bridge.js';
import { mainProductionAuthSmokeDispatchBridge } from './production-auth-smoke-dispatch-bridge.js';
import { mainWorktreeSafeBridge } from './worktree-safe-bridge.js';
import { mainWorktreeTextPatchBridge } from './worktree-text-patch-bridge.js';
import { mainHighRiskPrApproveBridgeV2 } from './high-risk-pr-approve-bridge.js';

void mainProductionMigrationApproveBridge().catch(error => {
  console.error('[NLO production migration approval bridge] fatal:', error);
  process.exitCode = 1;
});

void mainProductionAuthSmokeDispatchBridge().catch(error => {
  console.error('[NLO Production Auth Smoke dispatch bridge] fatal:', error);
  process.exitCode = 1;
});

void mainWorktreeSafeBridge().catch(error => {
  console.error('[NLO worktree safe bridge] fatal:', error);
  process.exitCode = 1;
});

void mainWorktreeTextPatchBridge().catch(error => {
  console.error('[NLO worktree text patch bridge] fatal:', error);
  process.exitCode = 1;
});

void mainHighRiskPrApproveBridgeV2().catch(error => {
  console.error('[NLO high-risk PR approval v2 bridge] fatal:', error);
  process.exitCode = 1;
});
