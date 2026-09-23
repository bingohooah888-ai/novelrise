$ErrorActionPreference = "Stop"
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$RuntimeRoot = Join-Path $env:LOCALAPPDATA "NOVELIGHT\Commander"
$KeyPath = Join-Path $RuntimeRoot "control-plane-key.dpapi"

if (-not (Get-Command tunnel-client -ErrorAction SilentlyContinue)) {
  throw "tunnel-client is required. Install the current OpenAI Secure MCP Tunnel client first."
}
if (-not $env:NOVELIGHT_COMMANDER_TUNNEL_ID) {
  throw "Set NOVELIGHT_COMMANDER_TUNNEL_ID in your local environment."
}
if (-not $env:CONTROL_PLANE_API_KEY) {
  throw "Set CONTROL_PLANE_API_KEY in your local environment. Never paste it into chat."
}

$McpCommand = 'node "{0}\src\index.js"' -f $Here
tunnel-client init --sample sample_mcp_stdio_local --profile novelight-commander --tunnel-id $env:NOVELIGHT_COMMANDER_TUNNEL_ID --mcp-command $McpCommand
tunnel-client doctor --profile novelight-commander --explain
if ($LASTEXITCODE -ne 0) {
  throw "Tunnel profile validation failed; credential was not persisted."
}

New-Item -ItemType Directory -Force -Path $RuntimeRoot | Out-Null
$SecureKey = ConvertTo-SecureString $env:CONTROL_PLANE_API_KEY -AsPlainText -Force
$EncryptedKey = ConvertFrom-SecureString $SecureKey
Set-Content -Path $KeyPath -Value $EncryptedKey -NoNewline

Write-Host "Tunnel profile configured."
Write-Host "CONTROL_PLANE_API_KEY was stored locally with Windows DPAPI for unattended restart."
Write-Host "Run .\install-openai-tunnel-autostart.ps1 once to enable logon startup and automatic recovery."
