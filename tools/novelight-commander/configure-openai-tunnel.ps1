$ErrorActionPreference = "Stop"
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$RuntimeRoot = Join-Path $env:LOCALAPPDATA "NOVELIGHT\Commander"
$KeyPath = Join-Path $RuntimeRoot "control-plane-key.dpapi"
$ClientInstallRoot = Join-Path $env:LOCALAPPDATA "NOVELIGHT\TunnelClient"
$ClientInstaller = Join-Path $Here "install-openai-tunnel-client.ps1"

function Resolve-TunnelClient {
  $Command = Get-Command tunnel-client -ErrorAction SilentlyContinue
  if ($Command) { return $Command.Source }

  $Installed = Get-ChildItem $ClientInstallRoot -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -eq "tunnel-client.exe" } |
    Select-Object -First 1
  if ($Installed) { return $Installed.FullName }

  if (-not (Test-Path $ClientInstaller)) {
    throw "tunnel-client is required and the NOVELIGHT bootstrap installer is missing."
  }

  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $ClientInstaller
  if ($LASTEXITCODE -ne 0) {
    throw "OpenAI tunnel-client bootstrap failed with exit code $LASTEXITCODE."
  }

  $Installed = Get-ChildItem $ClientInstallRoot -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -eq "tunnel-client.exe" } |
    Select-Object -First 1
  if (-not $Installed) {
    throw "tunnel-client bootstrap completed but tunnel-client.exe was not found."
  }
  return $Installed.FullName
}

function Load-ControlPlaneKey {
  if ($env:CONTROL_PLANE_API_KEY) {
    return $env:CONTROL_PLANE_API_KEY
  }
  if (-not (Test-Path $KeyPath)) {
    return $null
  }

  $Encrypted = (Get-Content -Raw -Path $KeyPath).Trim()
  if (-not $Encrypted) { return $null }
  $Secure = $Encrypted | ConvertTo-SecureString
  $Bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($Bstr)
  } finally {
    if ($Bstr -ne [IntPtr]::Zero) {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Bstr)
    }
  }
}

$TunnelClient = Resolve-TunnelClient
$ClientDir = Split-Path -Parent $TunnelClient
$env:Path = "$ClientDir;$env:Path"

if (-not $env:NOVELIGHT_COMMANDER_TUNNEL_ID) {
  $SavedTunnelId = [Environment]::GetEnvironmentVariable("NOVELIGHT_COMMANDER_TUNNEL_ID", "User")
  if ($SavedTunnelId) {
    $env:NOVELIGHT_COMMANDER_TUNNEL_ID = $SavedTunnelId
  }
}
if (-not $env:NOVELIGHT_COMMANDER_TUNNEL_ID) {
  throw "Set NOVELIGHT_COMMANDER_TUNNEL_ID in your local environment."
}

$ControlPlaneKey = Load-ControlPlaneKey
if (-not $ControlPlaneKey) {
  throw "CONTROL_PLANE_API_KEY is unavailable. Configure it locally once; never paste it into chat."
}
$env:CONTROL_PLANE_API_KEY = $ControlPlaneKey

# Keep the executable token as `node` so tunnel-client resolves it from PATH.
# Convert the script path to forward slashes because the tunnel-client argv parser
# treats backslashes as escape characters on Windows.
$IndexPath = (Join-Path $Here "src\index.js").Replace("\", "/")
$McpCommand = 'node "{0}"' -f $IndexPath

try {
  & $TunnelClient init --sample sample_mcp_stdio_local --profile novelight-commander --tunnel-id $env:NOVELIGHT_COMMANDER_TUNNEL_ID --mcp-command $McpCommand --force
  if ($LASTEXITCODE -ne 0) {
    throw "Tunnel profile creation failed with exit code $LASTEXITCODE."
  }

  & $TunnelClient doctor --profile novelight-commander --explain
  if ($LASTEXITCODE -ne 0) {
    throw "Tunnel profile validation failed; credential was not persisted."
  }

  New-Item -ItemType Directory -Force -Path $RuntimeRoot | Out-Null
  $SecureKey = ConvertTo-SecureString $ControlPlaneKey -AsPlainText -Force
  $EncryptedKey = ConvertFrom-SecureString $SecureKey
  Set-Content -Path $KeyPath -Value $EncryptedKey -NoNewline
} finally {
  Remove-Item Env:CONTROL_PLANE_API_KEY -ErrorAction SilentlyContinue
}

Write-Host "Tunnel profile configured."
Write-Host "CONTROL_PLANE_API_KEY was stored locally with Windows DPAPI for unattended restart."
Write-Host "Run .\install-openai-tunnel-autostart.ps1 once to enable logon startup and automatic recovery."
