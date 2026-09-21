$ErrorActionPreference = "Stop"
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not (Get-Command tunnel-client -ErrorAction SilentlyContinue)) {
  throw "tunnel-client is required. Install the current OpenAI Secure MCP Tunnel client first."
}
if (-not $env:NOVELIGHT_COMMANDER_TUNNEL_ID) { throw "Set NOVELIGHT_COMMANDER_TUNNEL_ID in your local environment." }
if (-not $env:CONTROL_PLANE_API_KEY) { throw "Set CONTROL_PLANE_API_KEY in your local environment. Never paste it into chat." }

$McpCommand = "node `"$Here\src\index.js`""
tunnel-client init --sample sample_mcp_stdio_local --profile novelight-commander --tunnel-id $env:NOVELIGHT_COMMANDER_TUNNEL_ID --mcp-command $McpCommand
tunnel-client doctor --profile novelight-commander --explain
Write-Host "Tunnel profile configured. Run .\run-openai-tunnel.ps1 to connect."
