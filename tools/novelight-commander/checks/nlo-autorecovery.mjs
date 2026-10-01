import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function read(relativePath) {
  return readFile(new URL(relativePath, root), "utf8");
}

test("NLO watchdog is anchored in Task Scheduler and runs every minute", async () => {
  const source = await read("install-nlo-autorecovery.ps1");
  assert.match(source, /NOVELIGHT Commander Watchdog/);
  assert.match(source, /New-ScheduledTaskTrigger -AtLogOn/);
  assert.match(source, /-RepetitionInterval \(New-TimeSpan -Minutes 1\)/);
  assert.match(source, /-MultipleInstances IgnoreNew/);
  assert.match(source, /-RunLevel Limited/);
  assert.match(source, /repair-nlo-services[.]ps1/);
  assert.match(source, /wscript[.]exe/);
  assert.match(source, /NOVELIGHT-Commander-Bridge[.]vbs/);
  assert.match(source, /nlo-watchdog[.]vbs/);
  assert.match(source, /Remove-Item -Path \$LegacyStartupFile/);
});

test("NLO repair script restores both bridge and tunnel supervisors", async () => {
  const source = await read("repair-nlo-services.ps1");
  assert.ok(source.includes("github-bridge-daemon[.]js"));
  assert.ok(source.includes("run-github-bridge[.]ps1"));
  assert.ok(source.includes("run-openai-tunnel[.]ps1"));
  assert.match(source, /NloTunnelClientCount/);
  assert.match(source, /novelight-commander/);
  assert.match(source, /BridgeHeartbeatMaxAgeSeconds = 120/);
  assert.match(source, /BridgeBusyMaxAgeSeconds = 300/);
  assert.match(source, /bridge-busy-watch[.]json/);
  assert.match(source, /busy request timed out/);
  assert.match(source, /BridgeBusyTimedOut/);
  assert.match(source, /heartbeat stale/);
  assert.match(source, /Stop-Process -Id \$Process[.]ProcessId -Force/);
  assert.match(source, /\$TunnelHealthy = \(/);
  assert.match(source, /\$TunnelTask[.]State -eq "Running"/);
  assert.match(source, /\$NloTunnelClientCount -gt 0/);
  assert.match(source, /if \(-not \$TunnelHealthy\)/);
  assert.match(source, /Start-ScheduledTask -TaskName "NOVELIGHT Commander Tunnel"/);
  assert.match(source, /Stop-ScheduledTask -TaskName "NOVELIGHT Commander Tunnel"/);
  assert.match(source, /Tunnel health failed: task=/);
  assert.match(source, /nlo_clients=/);
  assert.match(source, /Stopping orphaned NOVELIGHT tunnel-client process/);
  assert.match(source, /Stop-Process -Id \$Client[.]ProcessId -Force/);
  assert.match(source, /control-plane-key[.]dpapi/);
  assert.match(source, /github-token[.]dpapi/);
});

test("NLO MCP startup triggers Windows bridge/watchdog self-repair", async () => {
  const source = await read("src/x-bootstrap.js");
  assert.match(source, /process[.]platform !== 'win32'/);
  assert.match(source, /repair-nlo-services[.]ps1/);
  assert.match(source, /install-nlo-autorecovery[.]ps1/);
  assert.match(source, /windowsHide: true/);
  assert.match(source, /child[.]unref\(\)/);
  assert.match(source, /NOVELIGHT_DISABLE_STARTUP_AUTORECOVERY/);
});

test("NLO bridge publishes heartbeat and self-restarts after repeated poll failures", async () => {
  const source = await read("src/github-bridge-core.js");
  assert.match(source, /heartbeat[.]json/);
  assert.match(source, /writeHeartbeat/);
  assert.match(source, /AbortSignal[.]timeout\(15000\)/);
  assert.match(source, /consecutivePollFailures >= 6/);
  assert.match(source, /poll-stalled-restart/);
});

test("GitHub Bridge exposes a fixed NLO autorecovery installer action", async () => {
  const source = await read("src/github-bridge-core.js");
  assert.match(source, /autorecovery_install/);
  assert.match(source, /install-nlo-autorecovery[.]ps1/);
});

test("NLO bridge supervisor distinguishes planned, normal, and failed exits", async () => {
  const runner = await read("run-github-bridge.ps1");
  const core = await read("src/github-bridge-core.js");

  assert.match(runner, /\$ExitCode -eq 75/);
  assert.match(runner, /\$ExitCode -eq 0/);
  assert.match(runner, /supervisor stopping/);
  assert.match(runner, /\$MaxRestartDelaySeconds = 60/);
  assert.match(runner, /\$RestartDelaySeconds \* 2/);
  assert.match(core, /process[.]exit\(75\)/);
});

test("NLO bridge supervisor can self-recover invalid GitHub credentials from verified local owner auth", async () => {
  const runner = await read("run-github-bridge.ps1");

  assert.match(runner, /function Test-BridgeToken/);
  assert.match(runner, /function Recover-BridgeTokenFromGh/);
  assert.match(runner, /api user/);
  assert.match(runner, /bingohooah888-ai/);
  assert.match(runner, /Save-BridgeToken/);
  assert.match(runner, /ConvertFrom-SecureString/);
  assert.match(runner, /Resolve-BridgeToken -IssueNumber/);
});

test("NLO bridge supervisor does not treat native stderr warnings as fatal", async () => {
  const runner = await read("run-github-bridge.ps1");

  assert.match(runner, /\$NodePath = \(Get-Command node -ErrorAction Stop\)[.]Source/);
  assert.match(runner, /\$PreviousErrorActionPreference = \$ErrorActionPreference/);
  assert.match(runner, /\$ErrorActionPreference = 'Continue'/);
  assert.match(runner, /& \$NodePath \$DaemonPath \*>> \$LogPath/);
  assert.match(runner, /\$ExitCode = \$LASTEXITCODE/);
  assert.match(runner, /\$ErrorActionPreference = \$PreviousErrorActionPreference/);
});

test("GitHub Bridge configuration no longer installs a visible cmd startup launcher", async () => {
  const source = await read("configure-github-bridge.ps1");

  assert.match(source, /NOVELIGHT-Commander-Bridge[.]vbs/);
  assert.match(source, /WScript[.]Shell/);
  assert.match(source, /\$LegacyStartupFile = Join-Path \$StartupDir 'NOVELIGHT-Commander-Bridge[.]cmd'/);
  assert.match(source, /Remove-Item -Path \$LegacyStartupFile/);
});
