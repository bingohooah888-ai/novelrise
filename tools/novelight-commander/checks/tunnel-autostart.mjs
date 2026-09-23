import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function read(relativePath) {
  return readFile(new URL(relativePath, root), "utf8");
}

test("OpenAI tunnel runner automatically reconnects with bounded backoff", async () => {
  const source = await read("run-openai-tunnel.ps1");

  assert.match(source, /while \(\$true\)/);
  assert.match(source, /tunnel-client doctor --profile novelight-commander/);
  assert.match(source, /tunnel-client run --profile novelight-commander/);
  assert.match(source, /Restarting in \$DelaySeconds seconds/);
  assert.match(source, /\$MaxRestartDelaySeconds = 60/);
  assert.match(source, /control-plane-key\.dpapi/);
});

test("Tunnel configuration stores the control-plane key with Windows DPAPI", async () => {
  const source = await read("configure-openai-tunnel.ps1");

  assert.match(source, /ConvertTo-SecureString/);
  assert.match(source, /ConvertFrom-SecureString/);
  assert.match(source, /control-plane-key\.dpapi/);
  assert.doesNotMatch(source, /Set-Content[^\n]+CONTROL_PLANE_API_KEY/);
});

test("Windows autostart uses a current-user scheduled task with restart policy", async () => {
  const source = await read("install-openai-tunnel-autostart.ps1");

  assert.match(source, /New-ScheduledTaskTrigger -AtLogOn/);
  assert.match(source, /New-ScheduledTaskPrincipal/);
  assert.match(source, /-RunLevel Limited/);
  assert.match(source, /-RestartCount 999/);
  assert.match(source, /-RestartInterval \(New-TimeSpan -Minutes 1\)/);
  assert.match(source, /Start-ScheduledTask/);
  assert.match(source, /-WindowStyle Hidden/);
});
