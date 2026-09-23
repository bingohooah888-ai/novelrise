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
  assert.match(source, /doctor --profile novelight-commander/);
  assert.match(source, /optional Codex plugin\/UI checks must not keep NLO offline/);
  assert.doesNotMatch(source, /codex plugin install/);
  assert.match(source, /run --profile novelight-commander/);
  assert.match(source, /Restarting in \$DelaySeconds seconds/);
  assert.match(source, /\$MaxRestartDelaySeconds = 60/);
  assert.match(source, /control-plane-key\.dpapi/);
  assert.match(source, /install-openai-tunnel-client\.ps1/);
  assert.match(source, /NOVELIGHT\\TunnelClient/);
});

test("Tunnel configuration stores the control-plane key with Windows DPAPI", async () => {
  const source = await read("configure-openai-tunnel.ps1");

  assert.match(source, /ConvertTo-SecureString/);
  assert.match(source, /ConvertFrom-SecureString/);
  assert.match(source, /control-plane-key\.dpapi/);
  assert.doesNotMatch(source, /Set-Content[^\n]+CONTROL_PLANE_API_KEY/);
});

test("Windows tunnel configuration uses a parser-safe MCP command and checks init before doctor", async () => {
  const source = await read("configure-openai-tunnel.ps1");

  assert.match(source, /\.Replace\("\\\\", "\/"\)/);
  assert.match(source, /\$McpCommand = 'node "\{0\}"' -f \$IndexPath/);
  assert.match(source, /init --sample sample_mcp_stdio_local/);
  assert.match(source, /Tunnel profile creation failed with exit code/);
  assert.match(source, /doctor --profile novelight-commander --explain/);
  assert.match(source, /--force/);
});

test("Tunnel bootstrap downloads only the full Windows client and verifies SHA-256", async () => {
  const source = await read("install-openai-tunnel-client.ps1");

  assert.match(source, /api\.github\.com\/repos\/openai\/tunnel-client\/releases\/latest/);
  assert.match(source, /\^tunnel-client-v\.\+-windows-amd64/);
  assert.match(source, /SHA256SUMS\.txt/);
  assert.match(source, /Get-FileHash -Algorithm SHA256/);
  assert.match(source, /tunnel-client\.exe/);
  assert.match(source, /EnvironmentVariable\("Path", "User"\)/);
});

test("Windows autostart uses a current-user scheduled task with restart policy", async () => {
  const source = await read("install-openai-tunnel-autostart.ps1");

  assert.match(source, /New-ScheduledTaskTrigger -AtLogOn/);
  assert.match(source, /New-ScheduledTaskPrincipal/);
  assert.match(source, /-RunLevel Limited/);
  assert.match(source, /-RestartCount 999/);
  assert.match(source, /-RestartInterval \(New-TimeSpan -Minutes 1\)/);
  assert.match(source, /Start-ScheduledTask/);
  assert.match(source, /wscript[.]exe/);
  assert.match(source, /nlo-tunnel[.]vbs/);
  assert.match(source, /WScript[.]Shell/);
  assert.match(source, /Stop-ScheduledTask/);
});
