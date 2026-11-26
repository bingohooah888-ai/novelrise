// Local-owner-only offline package. Never imported by the public Issue Bridge.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';

const SHA = /^[a-f0-9]{64}$/u;
const MAX_SCRIPT = 4096;
const deny = () => { throw new Error('NLO_SANDBOX_PACKAGE_DENIED'); };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export function buildOfflineSandboxConfig(script, expectedSha256) {
  if (!Buffer.isBuffer(script) || script.length < 1 || script.length > MAX_SCRIPT ||
      !SHA.test(expectedSha256) || digest(script) !== expectedSha256) deny();
  const text = script.toString('utf8');
  if (text.includes('\0') || !Buffer.from(text, 'utf8').equals(script)) deny();
  const encoded = Buffer.from(text, 'utf16le').toString('base64');
  // No mapped folders, host credentials, clipboard, or network. The encoded
  // script is an explicitly approved LOCAL input and executes only in the guest.
  return '<Configuration>\n' +
    '  <Networking>Disable</Networking>\n' +
    '  <vGPU>Disable</vGPU>\n' +
    '  <AudioInput>Disable</AudioInput>\n' +
    '  <VideoInput>Disable</VideoInput>\n' +
    '  <PrinterRedirection>Disable</PrinterRedirection>\n' +
    '  <ClipboardRedirection>Disable</ClipboardRedirection>\n' +
    '  <ProtectedClient>Enable</ProtectedClient>\n' +
    '  <LogonCommand><Command>powershell.exe -NoProfile -NonInteractive -EncodedCommand ' +
    encoded + '</Command></LogonCommand>\n</Configuration>\n';
}

export async function prepareOfflineSandboxPackage({ scriptPath, expectedSha256, confirmation, tempRoot = os.tmpdir() }) {
  if (confirmation !== 'LOCAL_OWNER_APPROVES_OFFLINE_SCRIPT_ONLY' ||
      !path.isAbsolute(scriptPath) || !path.isAbsolute(tempRoot)) deny();
  try {
    const st = await fs.lstat(scriptPath);
    if (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1 || st.size > MAX_SCRIPT) deny();
    const root = await fs.realpath(tempRoot);
    const normalized = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
    if (normalized(root) !== normalized(tempRoot) || normalized(await fs.realpath(scriptPath)) !== normalized(scriptPath)) deny();
    const script = await fs.readFile(scriptPath);
    const config = buildOfflineSandboxConfig(script, expectedSha256);
    const dir = await fs.mkdtemp(path.join(root, 'nlo-offline-sandbox-'));
    const output = path.join(dir, 'approved-offline-job.wsb');
    const file = await fs.open(output, 'wx', 0o600);
    try { await file.writeFile(config, 'utf8'); await file.sync(); }
    finally { await file.close(); }
    return { result: 'OFFLINE_PACKAGE_PREPARED', output, scriptSha256: expectedSha256,
      configurationSha256: digest(Buffer.from(config)), launched: false, hostMappings: 0 };
  } catch { deny(); }
}

// Built-in smoke only: no caller-supplied code, URLs, executable paths or
// guest result transport. The operator must launch the .wsb locally.
export const OFFLINE_TOOL_SMOKE_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "Write-Host 'NLO_OFFLINE_SMOKE_BEGIN'",
  "if ((2 + 3) -eq 5) { Write-Host 'POWERSHELL_FIXED_PASS' }",
  "$node = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue",
  "if ($node) { & $node.Source -e 'process.exit(2+3===5?0:1)'; if ($LASTEXITCODE -eq 0) { Write-Host 'NODE_FIXED_PASS' } else { Write-Host 'NODE_FIXED_FAIL' } } else { Write-Host 'NODE_NOT_INSTALLED_IN_GUEST' }",
  "$edge = $null",
  "if (${env:ProgramFiles(x86)}) { $edge = Join-Path ${env:ProgramFiles(x86)} 'Microsoft\\Edge\\Application\\msedge.exe' }",
  "if ((-not $edge) -or (-not (Test-Path -LiteralPath $edge -PathType Leaf))) { $edge = Join-Path $env:ProgramFiles 'Microsoft\\Edge\\Application\\msedge.exe' }",
  "if (Test-Path -LiteralPath $edge -PathType Leaf) {",
  "  $profile = Join-Path $env:TEMP ('nlo-smoke-' + [guid]::NewGuid().ToString('N'))",
  "  $url = 'data:text/html,%3Chtml%3E%3Cbody%3E%3Cscript%3Edocument.body.textContent%3D%27NLO_DOM_PASS%27%3B%3C/script%3E%3C/body%3E%3C/html%3E'",
  "  $out = Join-Path $env:TEMP ('nlo-dom-' + [guid]::NewGuid().ToString('N') + '.txt')",
  "  $err = $out + '.err'",
  "  $child = Start-Process -FilePath $edge -ArgumentList @('--headless','--no-first-run','--disable-background-networking',('--user-data-dir=' + [char]34 + $profile + [char]34),'--dump-dom',$url) -RedirectStandardOutput $out -RedirectStandardError $err -PassThru",
  "  if (-not $child.WaitForExit(20000)) { $child.Kill(); Write-Host 'BROWSER_FIXED_TIMEOUT' } elseif ($child.ExitCode -eq 0 -and (Get-Content -Raw -LiteralPath $out) -match '<body>NLO_DOM_PASS</body>') { Write-Host 'BROWSER_FIXED_DOM_PASS' } else { Write-Host 'BROWSER_FIXED_DOM_FAIL' }",
  "} else { Write-Host 'BROWSER_NOT_INSTALLED_IN_GUEST' }",
  "Write-Host 'NLO_OFFLINE_SMOKE_END'",
  "Start-Sleep -Seconds 60"
].join('\r\n');

export function buildOfflineToolSmokeConfig(confirmation) {
  if (confirmation !== 'LOCAL_OWNER_APPROVES_FIXED_OFFLINE_SMOKE') deny();
  const script = Buffer.from(OFFLINE_TOOL_SMOKE_SCRIPT, 'utf8');
  return buildOfflineSandboxConfig(script, digest(script));
}

export async function prepareOfflineToolSmokePackage({ confirmation, tempRoot = os.tmpdir() }) {
  const config = buildOfflineToolSmokeConfig(confirmation);
  if (!path.isAbsolute(tempRoot)) deny();
  try {
    const root = await fs.realpath(tempRoot);
    const normalized = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
    if (normalized(root) !== normalized(tempRoot)) deny();
    const dir = await fs.mkdtemp(path.join(root, 'nlo-offline-sandbox-'));
    const output = path.join(dir, 'approved-offline-smoke.wsb');
    const file = await fs.open(output, 'wx', 0o600);
    try { await file.writeFile(config, 'utf8'); await file.sync(); }
    finally { await file.close(); }
    return { result: 'OFFLINE_SMOKE_PACKAGE_PREPARED', output,
      scriptSha256: digest(Buffer.from(OFFLINE_TOOL_SMOKE_SCRIPT)),
      configurationSha256: digest(Buffer.from(config)), launched: false, hostMappings: 0 };
  } catch { deny(); }
}
