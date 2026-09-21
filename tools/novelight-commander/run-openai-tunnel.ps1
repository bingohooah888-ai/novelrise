$ErrorActionPreference = "Stop"
if (-not (Get-Command tunnel-client -ErrorAction SilentlyContinue)) { throw "tunnel-client is required." }
if (-not $env:CONTROL_PLANE_API_KEY) { throw "Set CONTROL_PLANE_API_KEY in your local environment." }
tunnel-client doctor --profile novelight-commander --explain
tunnel-client run --profile novelight-commander
