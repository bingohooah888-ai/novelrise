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
});

test("NLO repair script restores both bridge and tunnel supervisors", async () => {
  const source = await read("repair-nlo-services.ps1");
  assert.match(source, /github-bridge-daemon[.]js/);
  assert.match(source, /run-github-bridge[.]ps1/);
  assert.match(source, /run-openai-tunnel[.]ps1/);
  assert.match(source, /Start-ScheduledTask -TaskName "NOVELIGHT Commander Tunnel"/);
  assert.match(source, /Stop-ScheduledTask -TaskName "NOVELIGHT Commander Tunnel"/);
  assert.match(source, /task reports Running but supervisor process is missing/);
  assert.match(source, /control-plane-key[.]dpapi/);
  assert.match(source, /github-token[.]dpapi/);
});

test("GitHub Bridge exposes a fixed NLO autorecovery installer action", async () => {
  const source = await read("src/github-bridge-daemon.js");
  assert.match(source, /autorecovery_install/);
  assert.match(source, /install-nlo-autorecovery[.]ps1/);
});
