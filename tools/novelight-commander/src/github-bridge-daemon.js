// Keep the established NOVELIGHT Bridge and X read loop in one supervised Node process.
// `bridge_update` exits this process with code 75, so the existing PowerShell supervisor
// restarts both loops together without depending on a parent-process restart.
import './github-bridge-core.js';
import './x-bridge-daemon.js';
